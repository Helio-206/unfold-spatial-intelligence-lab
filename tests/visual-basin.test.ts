import { expect,it } from 'vitest';
import { makeBasin, inspectTopology } from '../src/universal-spatial/visual-reconstruction/basin';
it('creates a bounded closed solid with an open cavity, consistent paired edges and positive volume',()=>{const g=makeBasin(2,1,1.5,.1),r=inspectTopology(g);expect(r).toMatchObject({vertices:16,triangles:28,boundaryEdges:0,nonManifoldEdges:0,inconsistentEdges:0,degenerate:0,finite:true});expect(r.signedVolume).toBeGreaterThan(0);g.dispose();expect(()=>makeBasin(1,1,1,.5)).toThrow();});
