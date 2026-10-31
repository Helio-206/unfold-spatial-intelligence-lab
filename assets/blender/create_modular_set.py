import math
import bpy
from mathutils import Vector

BLEND_OUTPUT = "/home/helio/HEr/META/unfold-app/assets/blender/modular_four_bar_set.blend"
GLB_OUTPUT = "/home/helio/HEr/META/unfold-app/public/assets/modular_four_bar_set.glb"


def make_material(name, color, metallic, roughness):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    return result


def bevelled_box(name, location, dimensions, bevel, material_slot):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new("edge_softening", "BEVEL")
    modifier.width = bevel
    modifier.segments = 3
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.materials.append(material_slot)
    return obj


def link(name, start, end, width, depth, material_slot, component_id):
    start = Vector(start)
    end = Vector(end)
    delta = end - start
    obj = bevelled_box(name, (start + end) / 2, (delta.length, width, depth), 0.035, material_slot)
    obj.rotation_euler[1] = math.atan2(-delta.z, delta.x)
    obj["component_id"] = component_id
    obj["solver_driven"] = False
    obj["parametric_length"] = delta.length
    obj["origin_role"] = "local +X from first pivot to second pivot"
    return obj


def collar(name, location, material_slot, component_id):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.14, depth=0.13, location=location, rotation=(0.0, 1.57079632679, 0.0))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material_slot)
    bevel = obj.modifiers.new("edge_softening", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj["component_id"] = component_id
    obj["solver_driven"] = False
    return obj


bpy.ops.wm.read_factory_settings(use_empty=True)

steel = make_material("industrial_steel", (0.20, 0.23, 0.22), 0.82, 0.42)
copper = make_material("industrial_copper", (0.55, 0.22, 0.08), 0.78, 0.30)
ivory = make_material("industrial_ivory", (0.70, 0.66, 0.56), 0.66, 0.37)
olive = make_material("industrial_olive", (0.37, 0.40, 0.28), 0.58, 0.45)
insert = make_material("industrial_insert", (0.025, 0.03, 0.03), 0.9, 0.2)

bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0.0, 0.0, 0.0))
root = bpy.context.object
root.name = "modular_four_bar_set"
root["asset_id"] = "modular_four_bar_set"
root["topology"] = "planar four-bar, four revolute joints"
root["reference_lengths_mm"] = "ground=100, crank=40, coupler=120, rocker=90"
root["solver_driven"] = False
root["runtime_note"] = "visual asset catalog; live parameterization is hybrid Three.js geometry"

# Reference pose uses metres as normalized visual units with the documented ratio.
a = Vector((0.0, 0.0, 0.0))
b = Vector((2.5, 0.0, 0.0))
c = Vector((0.32, 0.0, 0.56))
d = Vector((1.95, 0.0, 0.86))

parts = [
    link("ground_support", a, b, 0.18, 0.28, steel, "ground"),
    link("crank_link", a, c, 0.18, 0.28, copper, "crank"),
    link("coupler_link", c, d, 0.18, 0.28, ivory, "coupler"),
    link("rocker_link", d, b, 0.18, 0.28, olive, "rocker"),
]

for index, point in enumerate((a, b, c, d)):
    component_id = "joint_" + str(index)
    parts.append(collar(component_id + "_collar", point, steel if index < 2 else ivory, component_id))
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.065, depth=0.018, location=(point.x, -0.071, point.z), rotation=(0.0, 1.57079632679, 0.0))
    insert_obj = bpy.context.object
    insert_obj.name = component_id + "_insert"
    insert_obj.data.materials.append(insert)
    insert_obj["component_id"] = component_id
    insert_obj["solver_driven"] = False
    parts.append(insert_obj)

for part in parts:
    part.parent = root
    part.matrix_parent_inverse = root.matrix_world.inverted()

bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUTPUT)
bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for part in parts:
    part.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(
    filepath=GLB_OUTPUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
    export_animations=False,
)

print(f"created {BLEND_OUTPUT}")
print(f"created {GLB_OUTPUT}")
