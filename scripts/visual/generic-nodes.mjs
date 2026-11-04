// Counts shape nodes of a saved V2 plan reply whose parameters are exactly the old fixed "safe" defaults of PR #23, i.e. nodes the model's own
// proportions were thrown away for. Usage: node scripts/visual/generic-nodes.mjs <reply.json> [...]
import { readFile } from 'node:fs/promises';

const SAFE = {
  box: { dimensions: [0.8, 0.8, 0.8] }, rounded_box: { dimensions: [0.8, 0.8, 0.8], bevelM: 0.06, segments: 3 }, sphere: { radius: 0.4, widthSegments: 24, heightSegments: 16 },
  ellipsoid: { radii: [0.5, 0.35, 0.4], widthSegments: 24, heightSegments: 16 }, cylinder: { radiusTop: 0.3, radiusBottom: 0.3, height: 0.7, radialSegments: 24 }, cone: { radius: 0.35, height: 0.7, radialSegments: 24 },
  torus: { majorRadius: 0.4, tubeRadius: 0.08, radialSegments: 16, tubularSegments: 48 },
  extrude: { profile: [[-0.4, -0.25], [0.4, -0.25], [0.4, 0.25], [-0.4, 0.25]], depth: 0.15, bevelM: 0.02, curveSegments: 4 },
  tube: { points: [[-0.4, 0, 0], [0.4, 0, 0]], radius: 0.06, tubularSegments: 24, radialSegments: 8 },
  revolve: { profile: [[0.2, -0.35], [0.35, -0.2], [0.35, 0.2], [0.2, 0.35]], segments: 24 },
  loft: { profile: [[-0.4, -0.3], [0.4, -0.3], [0.4, 0.3], [-0.4, 0.3]], sections: [[0, 0.7, 0.7], [0.5, 0.5, 0.5]], capEnds: [true, true] },
};
const walk = (node, out) => { if (node.type === 'group') node.children.forEach((child) => walk(child, out)); else out.push(node); };
for (const path of process.argv.slice(2)) {
  const reply = JSON.parse(await readFile(path, 'utf8')), shapes = [];
  for (const component of reply.plan.components) walk(component.geometry, shapes);
  const generic = shapes.filter((node) => JSON.stringify(node.parameters) === JSON.stringify(SAFE[node.operator]));
  console.log(JSON.stringify({ plan: path, shapes: shapes.length, genericShapes: generic.length, share: +(generic.length / shapes.length).toFixed(2), genericKeys: generic.map((node) => `${node.key}(${node.operator})`) }));
}
