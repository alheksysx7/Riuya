import {z} from 'zod';
const base={nextArticleId:z.uuid().nullable(),articleId:z.uuid(),formulaVersion:z.literal(2),generatedAt:z.string(),participationLocked:z.boolean()};
const item=z.object({key:z.enum(['rami','beatriz','leo','dmitri','naoki','salma','tove','kavya','none']),name:z.string(),percentage:z.number().min(0).max(100)}).strict();
const coincidence=z.discriminatedUnion('state',[
 z.object({state:z.literal('available'),formulaVersion:z.literal('T07-v1'),percentage:z.number().min(0).max(100)}).strict(),
 z.object({state:z.literal('not_applicable')}).strict(),
 z.object({state:z.literal('insufficient_data')}).strict()
]).nullable();
const aspectItem=z.object({key:z.string().min(1).max(64),percentage:z.number().min(0).max(100)}).strict();
const distribution=z.object({items:z.array(aspectItem).min(1)}).strict();
const dimension=z.object({dimension:z.enum(['emotion','approach','stance']),personal:distribution.extend({coverage:z.number().min(0).max(1)}).nullable(),community:distribution.nullable()}).strict();
const aspects=z.union([z.object({state:z.literal('disabled'),items:z.array(z.never()).max(0)}).strict(),z.object({state:z.literal('available'),formulaVersion:z.literal('T07-v1'),dimensions:z.array(dimension).length(3).refine(items=>new Set(items.map(x=>x.dimension)).size===3)}).strict()]);
export const resultsSchema=z.discriminatedUnion('mode',[
 z.object({...base,coincidence:z.null(),mode:z.literal('preliminary'),community:z.null(),aspects:z.object({state:z.literal('insufficient_data'),items:z.array(z.never()).max(0)}).strict()}).strict(),
 z.object({...base,coincidence,mode:z.literal('complete'),community:z.object({participants:z.number().int().min(10),support:z.array(item).length(9).refine(items=>new Set(items.map(x=>x.key)).size===9)}).strict(),aspects}).strict()
]);
export type Results=z.infer<typeof resultsSchema>;
