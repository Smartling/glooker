import { getLLMClient, LLM_MODEL, extraBodyProps } from '@/lib/llm-provider';
import { TOOL_DEFINITIONS, executeTool } from './tools';

// Build a text description of available tools for the system prompt
const TOOLS_DESC = TOOL_DEFINITIONS.map(t => {
  const f = t.function;
  const params = Object.entries((f.parameters as any).properties || {})
    .map(([k, v]: [string, any]) => `${k}: ${v.type}${v.enum ? ` (${v.enum.join('|')})` : ''} — ${v.description}`)
    .join('\n      ');
  return `  ${f.name}: ${f.description}\n    Parameters:\n      ${params}`;
}).join('\n\n');

const SYSTEM_PROMPT = `You are Glooker Assistant — a data analyst for GitHub org developer analytics.

You have tools to query data. To call a tool, output EXACTLY this format on its own line:
TOOL_CALL: {"name": "toolName", "args": {key: value}}

After you output a TOOL_CALL, you'll receive the result. You can then call more tools or give your final answer.

Rules:
- Always use tools to get data — never guess numbers
- You can make multiple TOOL_CALL lines in sequence if needed
- Be concise — answer first, then data
- Use @login format for developers
- Round to 1 decimal place
- The org parameter is always auto-injected, you don't need to specify it

Formatting rules (IMPORTANT — the chat window is narrow, ~45 chars wide):
- For tables: use MAX 3-4 short columns. Abbreviate headers (e.g. "Dev", "Impact", "Cmplx")
- Keep table cell values short — use numbers not sentences
- Prefer bullet lists over wide tables when possible
- Truncate developer names to login only (@login) in tables
- Never use tables wider than 4 columns

Available tools:

${TOOLS_DESC}`;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const MAX_ITERATIONS = 5;

export async function runChatAgent(
  messages: ChatMessage[],
  org: string,
): Promise<{ response: string; toolCalls: string[] }> {
  const client = await getLLMClient();
  const toolCalls: string[] = [];

  const conversation: any[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\nCurrent org: ${org}` },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.3,
      max_tokens: 1500,
      messages: conversation,
      ...extraBodyProps(),
    } as any);

    const content = response.choices[0]?.message?.content || '';

    // Check if the LLM wants to call tools
    const toolCallMatches = content.match(/TOOL_CALL:\s*(\{.*\})/g);

    if (toolCallMatches && toolCallMatches.length > 0) {
      // Add assistant message to conversation
      conversation.push({ role: 'assistant', content });

      let toolResults = '';
      for (const match of toolCallMatches) {
        const jsonStr = match.replace(/^TOOL_CALL:\s*/, '');
        try {
          const parsed = JSON.parse(jsonStr);
          const fnName = parsed.name;
          const fnArgs = parsed.args || {};
          if (!fnArgs.org) fnArgs.org = org;

          toolCalls.push(`${fnName}(${JSON.stringify(fnArgs)})`);
          const result = await executeTool(fnName, fnArgs);
          toolResults += `\nResult of ${fnName}:\n${result}\n`;
        } catch {
          toolResults += `\nError: Could not parse tool call: ${jsonStr}\n`;
        }
      }

      conversation.push({ role: 'user', content: `[Tool results]${toolResults}\n\nNow provide your final answer based on the data above. Do NOT output any more TOOL_CALL lines.` });
      continue;
    }

    // No tool calls — this is the final answer. Strip any accidental TOOL_CALL artifacts.
    const cleanResponse = content.replace(/TOOL_CALL:.*$/gm, '').trim();
    return { response: cleanResponse, toolCalls };
  }

  return { response: 'I hit the maximum number of data lookups. Try a more specific question.', toolCalls };
}
