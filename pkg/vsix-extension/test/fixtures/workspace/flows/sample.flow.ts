/**
 * Test fixture — minimal valid .flow.ts with a JSON footer so the
 * footer fast-path parses it without needing the evaluator.
 */
import { defineFlow } from '@flowlib/sdk';

export default defineFlow({ nodes: [], edges: [] });

/* @flowlib-definition
{
  "nodes": [
    { "id": "n1", "type": "trigger.manual", "referenceId": "start", "params": { "inputs": [] }, "position": { "x": 0, "y": 0 } },
    { "id": "n2", "type": "core.output", "referenceId": "out", "params": {}, "position": { "x": 280, "y": 0 } }
  ],
  "edges": [{ "id": "e1", "source": "n1", "target": "n2" }],
  "metadata": { "name": "sample" }
}
*/
