import {z} from 'zod';
export const inputSchema=z.object({revisionId:z.uuid(),operationId:z.uuid(),choiceKind:z.enum(['voices','none']),opinionIds:z.array(z.uuid()).max(8)}).strict().superRefine((v,ctx)=>{if(new Set(v.opinionIds).size!==v.opinionIds.length||(v.choiceKind==='none'&&v.opinionIds.length!==0)||(v.choiceKind==='voices'&&v.opinionIds.length<1))ctx.addIssue({code:'custom',message:'Selección inválida'});});
export const stateSchema=z.discriminatedUnion('status',[z.object({status:z.literal('pending'),omittedAt:z.string().nullable(),locked:z.boolean()}),z.object({status:z.literal('omitted'),omittedAt:z.string(),locked:z.boolean()}),z.object({status:z.literal('confirmed'),id:z.uuid(),revisionId:z.uuid(),choiceKind:z.enum(['voices','none']),opinionIds:z.array(z.uuid()).max(8),confirmedAt:z.string()})]);
export type ParticipationState=z.infer<typeof stateSchema>;

export const receiptSchema=z.object({id:z.uuid(),status:z.literal('confirmed'),choiceKind:z.enum(['voices','none']),confirmedAt:z.string()}).strict();
export const omitSchema=z.object({status:z.literal('omitted'),omittedAt:z.string(),nextArticleId:z.uuid().nullable()}).strict();
