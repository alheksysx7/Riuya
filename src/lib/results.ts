import {z} from 'zod';
const base={nextArticleId:z.uuid().nullable(),articleId:z.uuid(),formulaVersion:z.literal(2),generatedAt:z.string(),participationLocked:z.boolean(),coincidence:z.null()};
const item=z.object({key:z.enum(['rami','beatriz','leo','dmitri','naoki','salma','tove','kavya','none']),name:z.string(),percentage:z.number().min(0).max(100)}).strict();
export const resultsSchema=z.discriminatedUnion('mode',[
 z.object({...base,mode:z.literal('preliminary'),community:z.null(),aspects:z.object({state:z.literal('insufficient_data'),items:z.array(z.never()).max(0)}).strict()}).strict(),
 z.object({...base,mode:z.literal('complete'),community:z.object({participants:z.number().int().min(10),support:z.array(item).length(9).refine(items=>new Set(items.map(x=>x.key)).size===9)}).strict(),aspects:z.object({state:z.literal('disabled'),items:z.array(z.never()).max(0)}).strict()}).strict()
]);
export type Results=z.infer<typeof resultsSchema>;
