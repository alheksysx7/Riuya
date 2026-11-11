import {z} from 'zod';
export const notificationSettingsSchema=z.object({newsOptIn:z.boolean(),resultsOptIn:z.boolean(),hour:z.union([z.literal(8),z.literal(12),z.literal(19)]),timezone:z.string().min(1).max(100),version:z.number().int().min(0)}).strict();
export const notificationHistorySchema=z.array(z.object({id:z.uuid(),channel:z.enum(['news','results']),localDate:z.string(),timezone:z.string(),status:z.enum(['queued','sent','cancelled']),sentAt:z.string().nullable(),isExample:z.boolean()}).strict()).max(20);
export type NotificationSettings=z.infer<typeof notificationSettingsSchema>;
