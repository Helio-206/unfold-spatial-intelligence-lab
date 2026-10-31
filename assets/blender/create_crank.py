import bpy
from mathutils import Vector

BLEND_OUTPUT = "/home/helio/HEr/META/unfold-app/assets/blender/crank.blend"
GLB_OUTPUT = "/home/helio/HEr/META/unfold-app/public/assets/crank.glb"


def material(name, color, metallic, roughness):
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


def cylinder(name, location, radius, depth, material_slot, vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=(0.0, 1.57079632679, 0.0),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material_slot)
    bevel = obj.modifiers.new("edge_softening", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj


bpy.ops.wm.read_factory_settings(use_empty=True)

metal = material("crank_metal", (0.72, 0.36, 0.10), 0.82, 0.26)
dark_metal = material("crank_pivot_inserts", (0.035, 0.045, 0.05), 0.9, 0.2)

bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0.0, 0.0, 0.0))
root = bpy.context.object
root.name = "crank"
root["asset_id"] = "crank"
root["orientation"] = "local +X from pivot A to pivot B"
root["base_length"] = 1.0
root["solver_driven"] = True

parts = [
    bevelled_box("crank_link", (0.5, 0.0, 0.0), (0.82, 0.16, 0.24), 0.035, metal),
    cylinder("pivot_a_collar", (0.0, 0.0, 0.0), 0.14, 0.13, metal),
    cylinder("pivot_b_collar", (1.0, 0.0, 0.0), 0.14, 0.13, metal),
    cylinder("pivot_a_insert", (0.0, -0.071, 0.0), 0.065, 0.018, dark_metal),
    cylinder("pivot_b_insert", (1.0, -0.071, 0.0), 0.065, 0.018, dark_metal),
]

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
