/**
 * Generation guidance appended to the V2 plan prompt. It is deliberately about geometry quality, never about a subject: no object names, no
 * per-category templates. The model still decides what the thing is made of; these lines only ask it to produce a plan the compiler can show well.
 *
 * Why each line exists (observed in the saved PR #23 runs):
 * - sizes: the plans came back around 0.2-2 units with many default-looking values (0.8, 0.3), so parts looked like identical blobs;
 * - contact: components floated apart, and the "adjacent" constraints only compared bounding boxes;
 * - silhouette: bodies were boxes where a profile (revolve, loft, extrude) was needed;
 * - completeness: invalid parameter objects used to be replaced by a generic shape.
 */
export const SPATIAL_V2_GEOMETRY_GUIDANCE = [
  'Geometry quality rules:',
  '1) Use one consistent unit scale for the whole object and make its longest side between 2 and 10 units. Give every shape explicit, different dimensions that reflect its real proportions; never leave generic placeholder sizes.',
  '2) Parts that attach must touch or overlap their neighbour slightly (about 2 to 5 percent of the smaller dimension). No floating components. Child components use coordinates relative to their parent.',
  '3) Silhouette first: place the largest masses first, then the members that connect them, then details. Use revolve for bodies of rotation, loft or extrude for tapered or profiled parts, tube for curved rods and cables, rounded_box instead of box for manufactured parts, and repeat for repeated elements.',
  '4) Orient consistently: up is +Y, the longest axis of the object lies along X, symmetric pairs are mirrored about the object centre.',
  '5) Give different materials to parts that would differ in the real subject; avoid one uniform colour.',
  '6) Every shape needs its complete parameter object with the exact keys of its operator, integer segment counts inside the allowed ranges, closed non-self-crossing profiles.',
  '7) Cylinders, cones, tori and revolved parts are built around the Y axis. When a disc, wheel, ring or rod must face another direction or lie along another axis, set its rotationRad (about 1.5708 around X turns a Y-axis disc to face +Z).',
  '8) A shape placed inside the volume of a larger opaque shape is invisible. Put the details a viewer should see (faces, handles, openings, hanging or attached parts) on or just outside the surface of the mass that carries them, or give that mass an opening; the front of the object faces +Z.',
  '9) Use these exact JSON keys and never abbreviate them. Transform: {"position":[x,y,z],"rotationRad":[x,y,z],"scale":[x,y,z]}. Parameters by operator: ' + [
    'box {"dimensions":[width,height,depth]}',
    'rounded_box {"dimensions":[width,height,depth],"bevelM":n,"segments":int}',
    'sphere {"radius":n,"widthSegments":int,"heightSegments":int}',
    'ellipsoid {"radii":[x,y,z],"widthSegments":int,"heightSegments":int}',
    'cylinder {"radiusTop":n,"radiusBottom":n,"height":n,"radialSegments":int}',
    'cone {"radius":n,"height":n,"radialSegments":int}',
    'torus {"majorRadius":n,"tubeRadius":n,"radialSegments":int,"tubularSegments":int}',
    'extrude {"profile":[[x,y],...],"depth":n,"bevelM":n,"curveSegments":int}',
    'tube {"points":[[x,y,z],...],"radius":n,"tubularSegments":int,"radialSegments":int}',
    'revolve {"profile":[[radius,axial],...],"segments":int}',
    'loft {"profile":[[x,y],...],"sections":[[height,scaleX,scaleY],...],"capEnds":[bool,bool]}',
  ].join('; ') + '.',
  '10) Material is a JSON object, never a bare name: {"profile":"neutral|industrial|organic|glass|rubber|metal|accent","color":"#rrggbb","roughness":0..1,"metalness":0..1,"clearcoat":0..1}. Repeat is "null" or {"kind":"linear|radial","count":2..64,"axis":"x|y|z","spacingOrRadius":n}. Give each part its own colour.',
].join(' ');
