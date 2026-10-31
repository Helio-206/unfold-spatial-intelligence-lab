import { Group, MeshStandardMaterial, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { crankAssetTransform, FOUR_BAR_LAB_EVIDENCE, FOUR_BAR_LAB_MODE, FourBarLabScene } from '../src/four-bar-lab';

describe('Four-Bar Lab scene adapter', () => {
  it('mounts one reusable group with the hypothetical design and solved coordinates', () => {
    const scene = new Scene();
    const lab = new FourBarLabScene();
    lab.mount(scene);

    expect(FOUR_BAR_LAB_MODE).toBe('Four-Bar Lab');
    expect(lab.evidenceStatus).toBe(FOUR_BAR_LAB_EVIDENCE);
    expect(lab.root.parent).toBe(scene);
    expect(lab.currentResult.status).toBe('solved');
    expect(lab.currentResult.coordinates).toBeDefined();
    expect(lab.selectableMeshes()).toHaveLength(4);
  });

  it('recalculates the selected branch and angle without creating another scene root', () => {
    const scene = new Scene();
    const lab = new FourBarLabScene();
    lab.mount(scene);
    const root = lab.root;

    const result = lab.setAngle(90);
    lab.setBranch('minus');
    lab.select('coupler');

    expect(result.status).toBe('solved');
    expect(result.inputAngleRad).toBeCloseTo(Math.PI / 2);
    expect(lab.currentBranch).toBe('minus');
    expect(lab.selected).toBe('coupler');
    expect(lab.boundsFor('coupler').isEmpty()).toBe(false);
    expect(lab.root).toBe(root);
    expect(scene.children.filter((child) => child.name === 'four-bar-lab')).toHaveLength(1);
  });

  it('uses restrained role-specific materials and a local lab lighting rig', () => {
    const lab = new FourBarLabScene();
    const materials = new Map(lab.selectableMeshes().map((mesh) => [mesh.userData.labRole as string, mesh.material as MeshStandardMaterial]));

    expect(materials.get('crank')?.metalness).toBeGreaterThan(materials.get('ground')?.metalness ?? 0);
    expect(materials.get('crank')?.roughness).toBeLessThan(materials.get('ground')?.roughness ?? 1);
    expect(lab.root.getObjectByName('four-bar-lab-hemisphere')).toBeDefined();
    expect(lab.root.getObjectByName('four-bar-lab-key-light')).toBeDefined();
    expect(lab.root.getObjectByName('four-bar-lab-key-light')?.parent).toBe(lab.root);
  });

  it('uses solver-spaced mechanical profiles and layered pivot hardware in the industrial scene', () => {
    const lab = new FourBarLabScene({ theme: 'industrial' });
    const crank = lab.selectableMeshes().find((mesh) => mesh.userData.labRole === 'crank');
    const profile = crank?.geometry.userData;
    const joints: Group[] = [];
    lab.root.traverse((object) => { if (object.userData.labJoint) joints.push(object as Group); });

    expect(crank?.geometry.type).toBe('ExtrudeGeometry');
    expect(profile?.mechanicalProfile).toBe('rounded-link-with-pivot-bores');
    expect(profile?.pivotSpacing).toBeCloseTo(1.8, 6);
    expect(joints).toHaveLength(4);
    expect(joints.every((joint) => joint.children.length === 4)).toBe(true);

    lab.setLengths({ ...lab.currentLengths, crank: 50 });
    const resizedCrank = lab.selectableMeshes().find((mesh) => mesh.userData.labRole === 'crank');
    expect(resizedCrank?.geometry.userData.pivotSpacing).toBeCloseTo(2.25, 6);
    expect(lab.currentResult.status).toBe('solved');
  });

  it('scales the Blender crank proportionally for 40 mm and 50 mm solver lengths', () => {
    const start = new Vector3(0, 0.18, 0);
    const crank40 = crankAssetTransform(start, new Vector3(1.8, 0.18, 0));
    const crank50 = crankAssetTransform(start, new Vector3(2.25, 0.18, 0));

    expect(crank40.scaleX).toBeCloseTo(1.8, 8);
    expect(crank50.scaleX).toBeCloseTo(2.25, 8);
    expect(crank50.scaleX / crank40.scaleX).toBeCloseTo(1.25, 8);
    expect(crank40.position).not.toBe(start);
  });

  it('removes GPU-owned resources and detaches on cleanup', () => {
    const scene = new Scene();
    const lab = new FourBarLabScene();
    lab.mount(scene);
    lab.dispose();

    expect(lab.root.parent).toBeNull();
    expect(lab.root.children).toHaveLength(0);
    expect(lab.selectableMeshes()).toHaveLength(0);
  });

  it('separates the visual components without changing solver coordinates and restores exact transforms', () => {
    const scene = new Scene();
    const lab = new FourBarLabScene();
    lab.mount(scene);
    const assembledBounds = lab.bounds().clone();
    const assembledCoordinates = JSON.stringify(lab.currentResult.coordinates);
    const assembledMeshPositions = lab.selectableMeshes().map((mesh) => mesh.position.clone());

    lab.setExploded(true, true, 100);
    const explodedBounds = lab.bounds();

    expect(lab.currentVisualState).toBe('inspection');
    expect(lab.selectableMeshes()).toHaveLength(4);
    expect(explodedBounds.getCenter(new Vector3()).distanceTo(assembledBounds.getCenter(new Vector3()))).toBeGreaterThan(0.05);
    expect(JSON.stringify(lab.currentResult.coordinates)).toBe(assembledCoordinates);

    lab.setExploded(false, true, 200);
    const restoredBounds = lab.bounds();
    expect(lab.currentVisualState).toBe('assembled');
    expect(restoredBounds.min.distanceTo(assembledBounds.min)).toBeCloseTo(0, 6);
    expect(restoredBounds.max.distanceTo(assembledBounds.max)).toBeCloseTo(0, 6);
    lab.selectableMeshes().forEach((mesh, index) => expect(mesh.position.distanceTo(assembledMeshPositions[index])).toBeCloseTo(0, 6));
  });

  it('handles rapid reversal without retaining a stale visual offset', () => {
    const scene = new Scene();
    const lab = new FourBarLabScene();
    lab.mount(scene);
    const assembledBounds = lab.bounds().clone();

    lab.setExploded(true, false, 0);
    lab.update(260);
    lab.setExploded(false, false, 260);
    lab.update(1_200);

    expect(lab.currentVisualState).toBe('assembled');
    expect(lab.isVisualTransitioning).toBe(false);
    expect(lab.bounds().min.distanceTo(assembledBounds.min)).toBeCloseTo(0, 6);
    expect(lab.bounds().max.distanceTo(assembledBounds.max)).toBeCloseTo(0, 6);
  });

  it('keeps hand manipulation visual-only and clears it on reassemble', () => {
    const scene = new Scene();
    const lab = new FourBarLabScene();
    lab.mount(scene);
    const coordinates = JSON.stringify(lab.currentResult.coordinates);
    const assembled = lab.selectableMeshes().find((mesh) => mesh.userData.labRole === 'crank')?.position.clone();

    lab.setExploded(true, true, 100);
    lab.setInspectionOffset('crank', new Vector3(0.4, 0.1, -0.25));
    const moved = lab.selectableMeshes().find((mesh) => mesh.userData.labRole === 'crank')?.position;

    expect(moved?.distanceTo(assembled ?? new Vector3())).toBeGreaterThan(0.1);
    expect(JSON.stringify(lab.currentResult.coordinates)).toBe(coordinates);

    lab.setExploded(false, true, 200);
    const restored = lab.selectableMeshes().find((mesh) => mesh.userData.labRole === 'crank')?.position;
    expect(restored?.distanceTo(assembled ?? new Vector3())).toBeCloseTo(0, 6);
    expect(lab.inspectionOffset('crank').length()).toBeCloseTo(0, 6);
  });
});
