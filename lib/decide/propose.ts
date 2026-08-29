/**
 * lib/decide/propose.ts — Single model decision call with forced tool-use (T-42).
 * Model contract: AGENT.md §4.1–4.5.
 */

import type { Signal } from '@/lib/observe/types';
import type { ProductFact, Proposal } from '@/lib/policy/types';
import { PROPOSE_ACTION_TOOL, validateProposalInput } from './schema';
import { SYSTEM_PROMPT, buildRetryPromptBlock, buildUserPrompt } from './prompt';

export interface ProposeResult {
  ok: boolean;
  proposal?: Proposal;
  rawToolInput?: any;
  error?: string;
  modelUsed?: string;
}

export interface RetryContext {
  previousProposal: Proposal;
  previousRawInput?: any;
  rejectionRule: string;
  value: string | number;
  limit: string | number;
}

interface ChatCompletionMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/**
 * Single model decision call (or 1 retry on 429/5xx).
 */
export async function proposeAction(
  signal: Signal,
  catalog: ProductFact[],
  currentDay: number,
  retryContext?: RetryContext,
): Promise<ProposeResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'GROQ_API_KEY is not set in environment' };
  }

  const baseUrl = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  const userPrompt = buildUserPrompt(signal, catalog, currentDay);
  const catalogSkus = new Set(catalog.map((p) => p.sku));

  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  // Append retry conversation turn if policy rejected previous attempt (AGENT.md §4.5)
  if (retryContext) {
    const prevArgsStr = JSON.stringify(
      retryContext.previousRawInput ?? {
        action: retryContext.previousProposal.action,
        sku: retryContext.previousProposal.sku,
        discount_pct: retryContext.previousProposal.discount_pct,
        confidence: retryContext.previousProposal.confidence,
        justification: retryContext.previousProposal.justification,
      },
    );

    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_prev_proposal',
          type: 'function',
          function: {
            name: 'propose_action',
            arguments: prevArgsStr,
          },
        },
      ],
    });

    const retryBlock = buildRetryPromptBlock(
      retryContext.previousProposal,
      retryContext.rejectionRule,
      retryContext.value,
      retryContext.limit,
    );

    messages.push({
      role: 'user',
      content: retryBlock,
    });
  }

  const payload = {
    model,
    temperature: 0,
    max_tokens: 4000,
    tools: [{ type: 'function', function: PROPOSE_ACTION_TOOL }],
    tool_choice: { type: 'function', function: { name: 'propose_action' } },
    messages,
  };

  let responseJson: any = null;
  let attempt = 0;

  while (attempt < 2) {
    attempt++;
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000), // 20s timeout
      });

      if (res.ok) {
        responseJson = await res.json();
        break;
      }

      // Retry once on 429 or 5xx
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      const errText = await res.text();
      return {
        ok: false,
        error: `Groq API returned HTTP ${res.status}: ${errText.slice(0, 300)}`,
        modelUsed: model,
      };
    } catch (err: any) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      return {
        ok: false,
        error: `Groq API request failed: ${err.message}`,
        modelUsed: model,
      };
    }
  }

  // Parse forced tool call
  const choice = responseJson?.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];

  if (!toolCall || toolCall.function?.name !== 'propose_action') {
    return {
      ok: false,
      error: 'Model did not call propose_action tool',
      modelUsed: model,
    };
  }

  let rawInput: any = null;
  try {
    rawInput = JSON.parse(toolCall.function.arguments || '{}');
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to parse tool call JSON arguments: ${err.message}`,
      rawToolInput: toolCall.function.arguments,
      modelUsed: model,
    };
  }

  const validation = validateProposalInput(rawInput, signal.kind, catalogSkus);
  if (!validation.valid) {
    return {
      ok: false,
      error: `Off-schema proposal input: ${validation.error}`,
      rawToolInput: rawInput,
      modelUsed: model,
    };
  }

  return {
    ok: true,
    proposal: validation.proposal,
    rawToolInput: rawInput,
    modelUsed: model,
  };
}
