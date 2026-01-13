import { z } from "zod";

export const DraftEmailInput = z.object({
  region: z.string().min(2),
  companySize: z.enum(["solo", "small", "medium"]),
  description: z.string().min(10),
});

export type DraftEmailInput = z.infer<typeof DraftEmailInput>;

export const DraftEmailOutput = z.object({
  subject: z.string(),
  body: z.string(),
});

export type DraftEmailOutput = z.infer<typeof DraftEmailOutput>;
