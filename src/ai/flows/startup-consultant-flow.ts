'use server';
/**
 * @fileOverview An AI flow that acts as a startup consultant.
 *
 * - startupConsultant - A function that takes a business question and returns expert advice.
 */

import {ai} from '@/ai/genkit';
import {z} from 'zod';

const StartupConsultantInputSchema = z
  .string()
  .describe('A question for the startup consultant.');

const StartupConsultantOutputSchema = z
  .string()
  .describe('The expert advice from the consultant.');

export async function startupConsultant(
  prompt: z.infer<typeof StartupConsultantInputSchema>
): Promise<z.infer<typeof StartupConsultantOutputSchema>> {
  return startupConsultantFlow(prompt);
}

const consultantPrompt = ai.definePrompt({
  name: 'startupConsultantPrompt',
  input: {schema: StartupConsultantInputSchema},
  output: {schema: StartupConsultantOutputSchema.nullable()},
  prompt: `You are an expert startup consultant with years of experience advising early-stage companies. Your clients are founders who need clear, actionable, and encouraging advice.

  A founder has the following question:
  "{{{prompt}}}"

  Provide a concise, insightful, and practical response. Structure your answer in a way that is easy to digest, using bullet points or numbered lists where appropriate. Focus on strategies that are low-cost and high-impact. Your tone should be knowledgeable, supportive, and professional.
  `,
});

const startupConsultantFlow = ai.defineFlow(
  {
    name: 'startupConsultantFlow',
    inputSchema: StartupConsultantInputSchema,
    outputSchema: StartupConsultantOutputSchema,
  },
  async (prompt) => {
    const {output} = await consultantPrompt(prompt);
    // Ensure we always return a string to match the schema, even if the model returns null.
    return output || '';
  }
);
