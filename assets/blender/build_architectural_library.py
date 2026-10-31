"""Build a compact metre-scale architectural asset library for Blender and glTF."""

from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / "assets" / "blender" / "architectural_library.blend"
GLB = ROOT / "public" / "assets" / "architectural_library.glb"


def material(name, color, metallic=0.0, roughness=0.7):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    return value


def box(name, location, dimensions, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("edge_radius", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def cylinder(name, location, radius, depth, mat, axis="Z", vertices=20):
    rotation = (0, 0, 0) if axis == "Z" else ((0, 1.57079632679, 0) if axis == "X" else (1.57079632679, 0, 0))
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def root(name, description, objects, dimensions):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    parent = bpy.context.object
    parent.name = name
    parent["asset_id"] = name
    parent["unit"] = "metre"
    parent["gltf_local_axis"] = "+X wall/run axis; +Y vertical; +Z thickness"
    parent["blender_source_axis"] = "+X wall/run axis; +Z vertical; +Y thickness"
    parent["pivot"] = "origin at segment start on floor plane"
    parent["nominal_dimensions_m"] = dimensions
    parent["description"] = description
    for obj in objects:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return parent


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = "METRIC"
bpy.context.scene.unit_settings.scale_length = 1.0
bpy.context.scene.unit_settings.length_unit = "METERS"
bpy.context.preferences.filepaths.save_version = 0
plaster = material("wall_plaster_warm", (0.72, 0.69, 0.61), roughness=0.88)
concrete = material("wall_concrete", (0.43, 0.46, 0.45), roughness=0.82)
wood = material("door_oak", (0.29, 0.16, 0.075), roughness=0.58)
frame = material("window_powder_coat", (0.075, 0.095, 0.105), metallic=0.72, roughness=0.32)
glass = material("window_glazing", (0.32, 0.58, 0.67), metallic=0.18, roughness=0.12)
steel = material("connector_stainless", (0.55, 0.59, 0.58), metallic=0.86, roughness=0.26)
rubber = material("connector_isolator", (0.045, 0.052, 0.055), metallic=0.0, roughness=0.72)

# Wall and partition modules keep the segment origin on its lower-left endpoint.
wall_parts = [box("wall_core", (1.5, 0, 1.4), (3.0, 0.2, 2.8), plaster, 0.008)]
root("wall_ext_3000", "Exterior wall segment, 3000 x 2800 x 200 mm", wall_parts, "3.0,2.8,0.2")
partition_parts = [box("partition_core", (1.5, 0, 1.35), (3.0, 0.1, 2.7), concrete, 0.006)]
root("partition_int_3000", "Interior partition segment, 3000 x 2700 x 100 mm", partition_parts, "3.0,2.7,0.1")

# Door leaf/frame are separate meshes under one stable component pivot.
door_parts = [
    box("door_leaf", (0.45, 0, 1.04), (0.9, 0.035, 2.08), wood, 0.012),
    box("door_jamb_left", (-0.035, 0, 1.1), (0.07, 0.14, 2.2), plaster, 0.008),
    box("door_jamb_right", (0.935, 0, 1.1), (0.07, 0.14, 2.2), plaster, 0.008),
    box("door_head", (0.45, 0, 2.165), (1.0, 0.14, 0.07), plaster, 0.008),
    cylinder("hinge_low", (-0.005, 0.035, 0.35), 0.018, 0.06, steel, "Z", 12),
    cylinder("hinge_high", (-0.005, 0.035, 1.72), 0.018, 0.06, steel, "Z", 12),
]
root("door_single_900", "Single hinged door module, 900 x 2100 mm clear leaf", door_parts, "1.0,2.2,0.14")

# Window frame, sill and glazing remain in one compact, Three.js-friendly prefab.
window_parts = [
    box("window_glass", (0.6, 0, 1.45), (1.12, 0.018, 1.15), glass),
    box("window_left", (0.02, 0, 1.45), (0.045, 0.12, 1.28), frame, 0.006),
    box("window_right", (1.18, 0, 1.45), (0.045, 0.12, 1.28), frame, 0.006),
    box("window_head", (0.6, 0, 2.07), (1.2, 0.12, 0.045), frame, 0.006),
    box("window_sill", (0.6, 0.015, 0.83), (1.28, 0.22, 0.075), concrete, 0.012),
    box("window_mullion", (0.6, 0, 1.45), (0.035, 0.12, 1.18), frame, 0.004),
]
root("window_double_1200", "Double glazed window module, sill at 800 mm", window_parts, "1.28,2.12,0.22")

# Reusable corner plate and isolated adjustable mounting foot.
corner_parts = [box("corner_plate", (0.05, 0, 0.12), (0.1, 0.16, 0.24), steel, 0.008)]
corner_parts += [cylinder("anchor_bolt_%d" % i, (x, y, 0.12 + z), 0.012, 0.07, steel, "Y", 12) for i, (x, y, z) in enumerate(((-0.025, -0.035, -0.045), (0.025, -0.035, -0.045), (-0.025, -0.035, 0.045), (0.025, -0.035, 0.045)))]
root("connector_corner_90", "Bolted 90 degree wall corner connector", corner_parts, "0.1,0.24,0.16")
foot_parts = [cylinder("mounting_foot", (0, 0, 0.08), 0.055, 0.16, rubber), cylinder("foot_bolt", (0, 0, 0.19), 0.016, 0.18, steel)]
root("connector_isolated_foot", "Reusable vibration-isolated mounting foot", foot_parts, "0.11,0.28,0.11")

# Small reusable mechanical frame, packaged independently from architecture modules.
frame_parts = []
for y in (0.0, 0.6):
    frame_parts.append(box("machine_rail", (0.5, 0, y), (1.0, 0.06, 0.055), steel, 0.006))
for x in (0.0, 1.0):
    frame_parts.append(box("machine_upright", (x, 0, 0.3), (0.055, 0.06, 0.6), steel, 0.006))
for x in (0.0, 1.0):
    for z in (0.0, 0.6):
        frame_parts.append(box("isolator_pad", (x, 0.045, z), (0.1, 0.03, 0.1), rubber, 0.006))
root("mechanical_frame_1000", "Parametric 1000 x 600 mm machine support frame", frame_parts, "1.0,0.6,0.12")

bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=str(GLB), export_format="GLB", use_selection=True, export_apply=True, export_materials="EXPORT", export_cameras=False, export_lights=False, export_animations=False)
print("created", BLEND)
print("created", GLB)
