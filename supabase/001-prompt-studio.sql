-- Apply in the existing MELON Supabase project, after Admin_GenAI migrations 001/004/005/006.
-- Run as database owner; leave RLS enabled. No service-role key is used by the app.
begin;
alter table public.prompt_chains add column if not exists studio_revision integer not null default 0;
alter table public.prompt_chain_steps add column if not exists studio_input_type text not null default 'image_and_text' check(studio_input_type in ('image_and_text','text'));
alter table public.prompt_chain_steps add column if not exists studio_output_type text not null default 'text' check(studio_output_type in ('text','json'));
alter table public.prompt_chain_steps add column if not exists studio_max_tokens integer not null default 300 check(studio_max_tokens between 64 and 2048);
alter table public.llm_responses add column if not exists studio_step_snapshot jsonb;
create table if not exists public.prompt_studio_runs (
 request_id uuid primary key references public.generation_requests(id),
 chain_name text not null, source_image_path text, final_output text check(length(final_output)<=20000)
);
alter table public.prompt_studio_runs enable row level security;
revoke all on public.prompt_studio_runs from public,anon,authenticated;

-- Serialize edits and detect stale browser tabs. Active executions use immutable snapshots.
create or replace function public.studio_lock_chain(target uuid,expected_revision integer) returns public.prompt_chains
language plpgsql security definer set search_path='' as $$
declare chain public.prompt_chains;
begin
 perform public.admin_assert_access();
 select * into chain from public.prompt_chains where id=target for update;
 if not found then raise exception 'Chain not found'; end if;
 if expected_revision is null or expected_revision<>chain.studio_revision then raise exception 'This chain changed in another tab. Reload before saving.'; end if;
 update public.generation_requests set status='failed',completed_at=now(),error_message='Generation timed out before completion.' where prompt_chain_id=target and status='processing' and created_at<now()-interval '15 minutes';
 if exists(select 1 from public.generation_requests where prompt_chain_id=target and status='processing') then raise exception 'A generation is using this chain. Wait until it finishes before editing.'; end if;
 return chain;
end $$;
-- Internal reorder helper: temporary positions above the old maximum avoid unique conflicts.
create or replace function public.studio_assign_order(target uuid,ordered_steps uuid[]) returns void
language plpgsql set search_path='' as $$
declare high integer;
begin
 if ordered_steps is null or cardinality(ordered_steps)<>(select count(*) from public.prompt_chain_steps where prompt_chain_id=target)
  or cardinality(ordered_steps)<>(select count(distinct s) from unnest(ordered_steps) s)
  or exists(select 1 from unnest(ordered_steps) s where s is null or not exists(select 1 from public.prompt_chain_steps where id=s and prompt_chain_id=target)) then raise exception 'Supply every step of this chain exactly once.'; end if;
 select coalesce(max(step_order),0) into high from public.prompt_chain_steps where prompt_chain_id=target;
 if high>2147483600 then raise exception 'Step positions need database-owner repair.'; end if;
 update public.prompt_chain_steps s set step_order=high+o.position from unnest(ordered_steps) with ordinality o(id,position) where s.id=o.id and s.prompt_chain_id=target;
 update public.prompt_chain_steps s set step_order=o.position from unnest(ordered_steps) with ordinality o(id,position) where s.id=o.id and s.prompt_chain_id=target;
end $$;

create or replace function public.studio_save_chain(target uuid,expected_revision integer,chain_name text,chain_description text,starter boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved uuid; model uuid;
begin
 perform public.admin_assert_access();
 if chain_name is null or length(btrim(chain_name)) not between 1 and 200 or chain_description is null or length(chain_description)>10000 then raise exception 'Enter a name (1–200 characters) and a description up to 10,000 characters.'; end if;
 if target is null then
  insert into public.prompt_chains(name,description) values(btrim(chain_name),btrim(chain_description)) returning id into saved;
  update public.prompt_chain_mix set enabled=false,weight=0 where prompt_chain_id=saved;
  if starter then
   select m.id into model from public.llm_models m join public.llm_providers p on p.id=m.provider_id where m.enabled and p.enabled and p.base_url='https://generativelanguage.googleapis.com/v1beta' and m.model_key ~ '^[a-zA-Z0-9._-]+$' order by m.created_at,m.id limit 1;
   if model is null then raise exception 'Configure an enabled Google Gemini model in Melon Admin first.'; end if;
   insert into public.prompt_chain_steps(prompt_chain_id,step_order,name,llm_model_id,system_prompt,user_prompt,temperature,studio_input_type,studio_output_type,studio_max_tokens) values
    (saved,1,'Describe the image',model,'Describe only visible details. Do not identify people or invent personal information. Keep the description under 100 words.','Describe this image for this direction: {{prompt}}',0.3,'image_and_text','text',512),
    (saved,2,'Find a funny angle',model,'Write one friendly, funny observation grounded in the description. Avoid harassment and invented facts. Keep it under 60 words.','Direction: {{prompt}}. Image description: {{previous_response}}',0.8,'text','text',512),
    (saved,3,'Write five captions',model,'Return a JSON array containing exactly five short, funny caption strings. Do not include markdown or other text. Each caption must be a complete sentence of 8 to 20 words.','Write five captions using this funny angle: {{previous_response}}. Original direction: {{prompt}}',0.8,'text','json',1024);
  end if;
 else
  perform public.studio_lock_chain(target,expected_revision);
  update public.prompt_chains set name=btrim(chain_name),description=btrim(chain_description),studio_revision=studio_revision+1 where id=target returning id into saved;
 end if;
 return saved;
end $$;
create or replace function public.studio_save_step(target_chain uuid,expected_revision integer,target_step uuid,step_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved uuid; model uuid; position integer; temp numeric; tokens integer;
begin
 perform public.studio_lock_chain(target_chain,expected_revision);
 if jsonb_typeof(step_data)<>'object' or step_data is null or pg_column_size(step_data)>50000 or exists(select 1 from jsonb_object_keys(step_data) k where k not in ('name','system_prompt','user_prompt','llm_model_id','temperature','studio_input_type','studio_output_type','studio_max_tokens')) then raise exception 'Invalid step fields'; end if;
 if length(btrim(coalesce(step_data->>'name',''))) not between 1 and 200 or length(coalesce(step_data->>'system_prompt',''))>10000 or length(btrim(coalesce(step_data->>'user_prompt',''))) not between 1 and 10000 then raise exception 'A step needs a name and user prompt. Prompts can be up to 10,000 characters.'; end if;
 model:=(step_data->>'llm_model_id')::uuid; temp:=(step_data->>'temperature')::numeric; tokens:=(step_data->>'studio_max_tokens')::integer;
 if temp is null or temp not between 0 and 2 or tokens is null or tokens not between 64 and 2048 or coalesce(step_data->>'studio_input_type','') not in ('text','image_and_text') or coalesce(step_data->>'studio_output_type','') not in ('text','json') then raise exception 'Invalid step settings'; end if;
 if not exists(select 1 from public.llm_models m join public.llm_providers p on p.id=m.provider_id where m.id=model and m.enabled and p.enabled and p.base_url='https://generativelanguage.googleapis.com/v1beta' and m.model_key ~ '^[a-zA-Z0-9._-]+$') then raise exception 'Choose an enabled Google Gemini model.'; end if;
 if target_step is null then
  if (select count(*) from public.prompt_chain_steps where prompt_chain_id=target_chain)>=5 then raise exception 'A chain can have at most five steps.'; end if;
  select coalesce(max(step_order),0)+1 into position from public.prompt_chain_steps where prompt_chain_id=target_chain;
  insert into public.prompt_chain_steps(prompt_chain_id,step_order,name,user_prompt,llm_model_id) values(target_chain,position,btrim(step_data->>'name'),step_data->>'user_prompt',model) returning id into saved;
 else
  if not exists(select 1 from public.prompt_chain_steps where id=target_step and prompt_chain_id=target_chain) then raise exception 'Step does not belong to this chain'; end if;
  saved:=target_step;
 end if;
 update public.prompt_chain_steps set name=btrim(step_data->>'name'),system_prompt=coalesce(step_data->>'system_prompt',''),user_prompt=step_data->>'user_prompt',llm_model_id=model,temperature=temp,studio_input_type=step_data->>'studio_input_type',studio_output_type=step_data->>'studio_output_type',studio_max_tokens=tokens where id=saved;
 update public.prompt_chains set studio_revision=studio_revision+1 where id=target_chain;
 return saved;
end $$;
create or replace function public.studio_reorder_steps(target_chain uuid,expected_revision integer,ordered_steps uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.studio_lock_chain(target_chain,expected_revision);
 perform public.studio_assign_order(target_chain,ordered_steps);
 update public.prompt_chains set studio_revision=studio_revision+1 where id=target_chain;
end $$;
-- Preserve execution history before removing definitions referenced by past responses.
create or replace function public.studio_detach_step_history(removed_steps uuid[]) returns void language plpgsql set search_path='' as $$
begin
 update public.llm_responses r set studio_step_snapshot=coalesce(r.studio_step_snapshot,(select s from public.generation_requests q cross join lateral jsonb_array_elements(q.execution_plan) s where q.id=r.generation_request_id and s->>'id'=r.prompt_chain_step_id::text limit 1)),prompt_chain_step_id=null where prompt_chain_step_id=any(removed_steps);
end $$;
create or replace function public.studio_delete_step(target_chain uuid,expected_revision integer,target_step uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.studio_lock_chain(target_chain,expected_revision);
 if not exists(select 1 from public.prompt_chain_steps where id=target_step and prompt_chain_id=target_chain) then raise exception 'Step does not belong to this chain'; end if;
 perform public.studio_detach_step_history(array[target_step]);
 delete from public.prompt_chain_steps where id=target_step and prompt_chain_id=target_chain;
 perform public.studio_assign_order(target_chain,array(select id from public.prompt_chain_steps where prompt_chain_id=target_chain order by step_order,id));
 update public.prompt_chains set studio_revision=studio_revision+1 where id=target_chain;
end $$;
create or replace function public.studio_delete_chain(target uuid,expected_revision integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.studio_lock_chain(target,expected_revision);
 perform public.studio_detach_step_history(array(select id from public.prompt_chain_steps where prompt_chain_id=target));
 update public.generation_requests set prompt_chain_id=null where prompt_chain_id=target;
 update public.ai_generation_examples set prompt_chain_id=null where prompt_chain_id=target;
 delete from public.prompt_chain_mix where prompt_chain_id=target;
 delete from public.prompt_chain_steps where prompt_chain_id=target;
 delete from public.prompt_chains where id=target;
end $$;

create or replace function public.studio_list_chains(search_text text default '',page_number integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total bigint;
begin
 perform public.admin_assert_access();
 if search_text is null or length(search_text)>200 or page_number is null or page_number not between 1 and 100000 then raise exception 'Invalid search or page'; end if;
 select count(*) into total from public.prompt_chains c where strpos(lower(c.name||' '||c.description),lower(search_text))>0;
 select coalesce(jsonb_agg(r),'[]') into result from (select c.*,(select count(*) from public.prompt_chain_steps s where s.prompt_chain_id=c.id) as step_count,(select count(*) from public.generation_requests q where q.prompt_chain_id=c.id) as run_count,exists(select 1 from public.prompt_chain_mix m where m.prompt_chain_id=c.id and m.enabled and m.weight>0) as in_melon_mix from public.prompt_chains c where strpos(lower(c.name||' '||c.description),lower(search_text))>0 order by c.created_at desc,c.id limit 20 offset (page_number-1)*20) r;
 return jsonb_build_object('items',result,'total',total,'page',page_number);
end $$;
create or replace function public.studio_get_chain(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.admin_assert_access();
 select to_jsonb(c)||jsonb_build_object('steps',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('model_name',m.name,'model_key',m.model_key,'temperature_supported',m.temperature_supported) order by s.step_order,s.id) from public.prompt_chain_steps s left join public.llm_models m on m.id=s.llm_model_id where s.prompt_chain_id=c.id),'[]'),'in_melon_mix',exists(select 1 from public.prompt_chain_mix m where m.prompt_chain_id=c.id and m.enabled and m.weight>0)) into result from public.prompt_chains c where id=target;
 return result;
end $$;
create or replace function public.studio_models() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.admin_assert_access();
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'model_key',m.model_key,'temperature_supported',m.temperature_supported) order by m.name,m.id) from public.llm_models m join public.llm_providers p on p.id=m.provider_id where m.enabled and p.enabled and p.base_url='https://generativelanguage.googleapis.com/v1beta' and m.model_key ~ '^[a-zA-Z0-9._-]+$'),'[]');
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('prompt-studio-assets','prompt-studio-assets',false,3145728,array['image/png','image/jpeg','image/webp']) on conflict(id) do update set public=false,file_size_limit=3145728,allowed_mime_types=excluded.allowed_mime_types;
-- Both permissive and restrictive policies: older broad storage policies cannot bypass these.
drop policy if exists studio_asset_read on storage.objects;
create policy studio_asset_read on storage.objects for select to authenticated using(bucket_id='prompt-studio-assets' and public.admin_is_authorized());
drop policy if exists studio_asset_insert on storage.objects;
create policy studio_asset_insert on storage.objects for insert to authenticated with check(bucket_id='prompt-studio-assets' and public.admin_is_authorized() and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists studio_asset_read_boundary on storage.objects;
create policy studio_asset_read_boundary on storage.objects as restrictive for select to authenticated using(bucket_id<>'prompt-studio-assets' or public.admin_is_authorized());
drop policy if exists studio_asset_insert_boundary on storage.objects;
create policy studio_asset_insert_boundary on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'prompt-studio-assets' or (public.admin_is_authorized() and (storage.foldername(name))[1]=auth.uid()::text));
drop policy if exists studio_asset_no_update on storage.objects;
create policy studio_asset_no_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'prompt-studio-assets') with check(bucket_id<>'prompt-studio-assets');
drop policy if exists studio_asset_cleanup on storage.objects;
create policy studio_asset_cleanup on storage.objects for delete to authenticated using(bucket_id='prompt-studio-assets' and public.admin_is_authorized() and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.prompt_studio_runs r where r.source_image_path=name));
-- Storage policy cannot directly read the private table as the browser role.
create or replace function public.studio_image_in_use(path text) returns boolean language plpgsql stable security definer set search_path='' as $$ begin perform public.admin_assert_access(); return exists(select 1 from public.prompt_studio_runs where source_image_path=path); end $$;
drop policy if exists studio_asset_cleanup on storage.objects;
create policy studio_asset_cleanup on storage.objects for delete to authenticated using(bucket_id='prompt-studio-assets' and public.admin_is_authorized() and (storage.foldername(name))[1]=auth.uid()::text and not public.studio_image_in_use(name));
drop policy if exists studio_asset_delete_boundary on storage.objects;
create policy studio_asset_delete_boundary on storage.objects as restrictive for delete to authenticated using(bucket_id<>'prompt-studio-assets' or (public.admin_is_authorized() and (storage.foldername(name))[1]=auth.uid()::text and not public.studio_image_in_use(name)));
drop policy if exists studio_asset_no_anon on storage.objects;
create policy studio_asset_no_anon on storage.objects as restrictive for all to anon using(bucket_id<>'prompt-studio-assets') with check(bucket_id<>'prompt-studio-assets');

create or replace function public.studio_begin_run(target_chain uuid,expected_revision integer,caption_prompt text,image_path text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare chain public.prompt_chains; plan jsonb; request_id uuid;
begin
 perform public.admin_assert_access();
 select * into chain from public.prompt_chains where id=target_chain for update;
 if not found or expected_revision is distinct from chain.studio_revision then raise exception 'The workflow changed. Reload before generating.'; end if;
 if caption_prompt is null or length(btrim(caption_prompt)) not between 5 and 2000 then raise exception 'Enter a direction between 5 and 2,000 characters.'; end if;
 if (select count(*) from public.prompt_chain_steps where prompt_chain_id=target_chain) not between 1 and 5 then raise exception 'Add between one and five steps before running this workflow.'; end if;
 if exists(select 1 from public.prompt_chain_steps s left join public.llm_models m on m.id=s.llm_model_id left join public.llm_providers p on p.id=m.provider_id where s.prompt_chain_id=target_chain and (m.id is null or not m.enabled or not p.enabled or p.base_url is distinct from 'https://generativelanguage.googleapis.com/v1beta' or m.model_key !~ '^[a-zA-Z0-9._-]+$')) then raise exception 'All steps need an enabled Google Gemini model.'; end if;
 if image_path is not null and (split_part(image_path,'/',1)<>auth.uid()::text or not exists(select 1 from storage.objects where bucket_id='prompt-studio-assets' and name=image_path)) then raise exception 'Upload your source image first.'; end if;
 if image_path is null and exists(select 1 from public.prompt_chain_steps where prompt_chain_id=target_chain and studio_input_type='image_and_text') then raise exception 'This workflow requires an image.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 update public.generation_requests set status='failed',error_message='Generation timed out before completion.',completed_at=now() where user_id=auth.uid() and status='processing' and created_at<now()-interval '15 minutes';
 if (select count(*) from public.generation_requests where user_id=auth.uid() and status='processing')>=3 then raise exception 'Wait for an existing generation to finish.'; end if;
 select jsonb_agg(jsonb_build_object('id',s.id,'order',s.step_order,'name',s.name,'system_prompt',s.system_prompt,'user_prompt',s.user_prompt,'model_id',m.id,'model_key',m.model_key,'temperature',s.temperature,'temperature_supported',m.temperature_supported,'input_type',s.studio_input_type,'output_type',s.studio_output_type,'max_tokens',s.studio_max_tokens) order by s.step_order,s.id) into plan from public.prompt_chain_steps s join public.llm_models m on m.id=s.llm_model_id where s.prompt_chain_id=target_chain;
 insert into public.generation_requests(user_id,prompt_chain_id,prompt,status,source,execution_plan) values(auth.uid(),target_chain,btrim(caption_prompt),'processing','live',plan) returning id into request_id;
 insert into public.prompt_studio_runs(request_id,chain_name,source_image_path) values(request_id,chain.name,image_path);
 return jsonb_build_object('request_id',request_id,'steps',plan);
end $$;
create or replace function public.studio_record_response(target_request uuid,target_step uuid,output_text text,input_token_count integer,output_token_count integer,elapsed_ms integer,sent_prompt text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.admin_assert_access();
 if not exists(select 1 from public.prompt_studio_runs where request_id=target_request) then raise exception 'Studio run not found'; end if;
 perform public.record_caption_response_details(target_request,target_step,output_text,input_token_count,output_token_count,elapsed_ms,sent_prompt);
 update public.llm_responses r set studio_step_snapshot=(select s from public.generation_requests q cross join lateral jsonb_array_elements(q.execution_plan) s where q.id=target_request and s->>'id'=target_step::text limit 1) where r.generation_request_id=target_request and r.prompt_chain_step_id=target_step;
end $$;
create or replace function public.studio_complete_run(target_request uuid) returns void
language plpgsql security definer set search_path='' as $$
declare request public.generation_requests; final_text text;
begin
 perform public.admin_assert_access();
 select q.* into request from public.generation_requests q join public.prompt_studio_runs r on r.request_id=q.id where q.id=target_request and q.user_id=auth.uid() for update of q;
 if not found then raise exception 'Run not found' using errcode='42501'; end if;
 if request.status='completed' then return; end if;
 if request.status<>'processing' or (select count(*) from public.llm_responses where generation_request_id=target_request)<>jsonb_array_length(request.execution_plan) then raise exception 'Complete every step before finalizing.'; end if;
 select response_text into final_text from public.llm_responses where generation_request_id=target_request and prompt_chain_step_id=(request.execution_plan->-1->>'id')::uuid;
 if final_text is null then raise exception 'Final response missing'; end if;
 update public.prompt_studio_runs set final_output=final_text where request_id=target_request;
 update public.generation_requests set status='completed',completed_at=now() where id=target_request;
end $$;

create or replace function public.studio_list_runs(target_chain uuid default null,page_number integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare total bigint; result jsonb;
begin
 perform public.admin_assert_access();
 if page_number is null or page_number not between 1 and 100000 then raise exception 'Invalid page'; end if;
 select count(*) into total from public.generation_requests q where (target_chain is null and (q.execution_plan is not null or exists(select 1 from public.prompt_studio_runs where request_id=q.id)) or q.prompt_chain_id=target_chain);
 select coalesce(jsonb_agg(r),'[]') into result from (select q.id,q.prompt_chain_id,q.prompt,q.status,q.error_message,q.created_at,q.completed_at,coalesce(c.name,s.chain_name,'Deleted workflow') as chain_name,coalesce(s.final_output,g.caption) as final_output,case when s.source_image_path is not null then 'prompt-studio-assets' when g.image_path is not null then 'generated-media' end as image_bucket,coalesce(s.source_image_path,g.image_path) as image_path,(select count(*) from public.llm_responses where generation_request_id=q.id) as response_count from public.generation_requests q left join public.prompt_chains c on c.id=q.prompt_chain_id left join public.prompt_studio_runs s on s.request_id=q.id left join public.ai_generations g on g.id=q.generation_id where (target_chain is null and (q.execution_plan is not null or s.request_id is not null) or q.prompt_chain_id=target_chain) order by q.created_at desc,q.id limit 12 offset (page_number-1)*12) r;
 return jsonb_build_object('items',result,'total',total,'page',page_number);
end $$;
create or replace function public.studio_get_run(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare request public.generation_requests; result jsonb;
begin
 perform public.admin_assert_access();
 select * into request from public.generation_requests where id=target;
 if not found then return null; end if;
 select to_jsonb(request)||jsonb_build_object('chain_name',coalesce(c.name,s.chain_name,'Deleted workflow'),'final_output',coalesce(s.final_output,g.caption),'image_bucket',case when s.source_image_path is not null then 'prompt-studio-assets' when g.image_path is not null then 'generated-media' end,'image_path',coalesce(s.source_image_path,g.image_path),'studio_run',s.request_id is not null,'responses',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('snapshot',coalesce(r.studio_step_snapshot,(select step from jsonb_array_elements(request.execution_plan) step where step->>'id'=r.prompt_chain_step_id::text limit 1))) order by r.created_at,r.id) from public.llm_responses r where r.generation_request_id=target),'[]')) into result from (select 1) singleton left join public.prompt_chains c on c.id=request.prompt_chain_id left join public.prompt_studio_runs s on s.request_id=request.id left join public.ai_generations g on g.id=request.generation_id;
 return result;
end $$;

-- Internal helpers are never exposed. Every public RPC checks the current Google superadmin.
revoke all on function public.studio_lock_chain(uuid,integer),public.studio_assign_order(uuid,uuid[]),public.studio_detach_step_history(uuid[]) from public,anon,authenticated;
revoke all on function public.studio_save_chain(uuid,integer,text,text,boolean),public.studio_save_step(uuid,integer,uuid,jsonb),public.studio_reorder_steps(uuid,integer,uuid[]),public.studio_delete_step(uuid,integer,uuid),public.studio_delete_chain(uuid,integer),public.studio_list_chains(text,integer),public.studio_get_chain(uuid),public.studio_models(),public.studio_image_in_use(text),public.studio_begin_run(uuid,integer,text,text),public.studio_record_response(uuid,uuid,text,integer,integer,integer,text),public.studio_complete_run(uuid),public.studio_list_runs(uuid,integer),public.studio_get_run(uuid) from public,anon,authenticated;
grant execute on function public.studio_save_chain(uuid,integer,text,text,boolean),public.studio_save_step(uuid,integer,uuid,jsonb),public.studio_reorder_steps(uuid,integer,uuid[]),public.studio_delete_step(uuid,integer,uuid),public.studio_delete_chain(uuid,integer),public.studio_list_chains(text,integer),public.studio_get_chain(uuid),public.studio_models(),public.studio_image_in_use(text),public.studio_begin_run(uuid,integer,text,text),public.studio_record_response(uuid,uuid,text,integer,integer,integer,text),public.studio_complete_run(uuid),public.studio_list_runs(uuid,integer),public.studio_get_run(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
