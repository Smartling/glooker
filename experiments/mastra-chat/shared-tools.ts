/**
 * ONE tool definition, both arms.
 *
 * Both the control arm and the Mastra arm are built from the repo's existing
 * TOOL_DEFINITIONS and dispatch through the existing executeTool(). Identical
 * data access, identical schemas — so any difference the comparison shows is
 * orchestration, not tooling.
 */
import { TOOL_DEFINITIONS, executeTool } from '../../src/lib/chat/tools';

/** The model never supplies `org`; the caller injects it (same as agent.ts today). */
function modelFacingSchema(parameters: any) {
  const { org, ...properties } = parameters.properties ?? {};
  return {
    type: 'object',
    properties,
    required: (parameters.required ?? []).filter((r: string) => r !== 'org'),
    additionalProperties: false,
  };
}

export interface ToolSpec {
  name: string;
  description: string;
  schema: any;
}

export const TOOL_SPECS: ToolSpec[] = TOOL_DEFINITIONS.map(t => ({
  name: t.function.name,
  description: t.function.description,
  schema: modelFacingSchema(t.function.parameters),
}));

/** Anthropic Messages API tool format. */
export const anthropicTools = () =>
  TOOL_SPECS.map(s => ({ name: s.name, description: s.description, input_schema: s.schema }));

/** Run a tool with `org` injected, recording the call for comparison. */
export async function runTool(
  name: string,
  args: Record<string, any>,
  org: string,
  log: string[],
): Promise<string> {
  log.push(`${name}(${JSON.stringify(args)})`);
  return executeTool(name, { ...args, org });
}
