export type Model={id:string;name:string;model_key:string;temperature_supported:boolean}
export type Step={id:string;name:string;step_order:number;system_prompt:string;user_prompt:string;llm_model_id:string;temperature:number;studio_input_type:'text'|'image_and_text';studio_output_type:'text'|'json';studio_max_tokens:number;model_name?:string;model_key?:string}
export type Chain={id:string;name:string;description:string;studio_revision:number;created_at:string;updated_at?:string;steps:Step[];step_count?:number;run_count?:number;in_melon_mix:boolean}
export type PlanStep={id:string;order:number;name:string;model_key:string;system_prompt:string;user_prompt:string;temperature:number;temperature_supported:boolean;input_type:'text'|'image_and_text';output_type:'text'|'json';max_tokens:number}
export type Plan={request_id:string;steps:PlanStep[]}
export type RecordedResponse={id:string;response_text:string;submitted_prompt?:string;input_tokens:number|null;output_tokens:number|null;latency_ms:number|null;snapshot:PlanStep|null;created_at:string}
export type Run={id:string;prompt_chain_id:string|null;chain_name:string;prompt:string;status:string;error_message?:string;created_at:string;completed_at?:string;final_output?:string;image_bucket?:string;image_path?:string;image_url?:string;responses:RecordedResponse[];response_count?:number;execution_plan:PlanStep[];studio_run?:boolean}
export type PageResult<T>={items:T[];total:number;page:number}
