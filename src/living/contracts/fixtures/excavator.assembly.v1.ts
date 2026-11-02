// Gerado a partir de excavator.assembly.v1.json (o JSON é a fonte; este módulo existe para o browser e para tipos).
// Fixture SINTÉTICO: dimensões escolhidas por plausibilidade, sem origem num fabricante. Todas as proveniências são origin "fixture", validation "unreviewed".
import type { Assembly } from '../assembly.v1';

export const EXCAVATOR_ASSEMBLY_V1: Assembly = {
  "schema": "unfold.assembly.v1",
  "id": "excavator-fixture-1",
  "title": "Escavadora de rastos (fixture sintético)",
  "units": {
    "length": "m",
    "angle": "rad",
    "time": "s"
  },
  "sources": [
    {
      "id": "src-excavator-fixture",
      "kind": "fixture",
      "title": "Escavadora sintética para testes do motor. Dimensões escolhidas por plausibilidade; não são de nenhum fabricante nem têm valor de projecto."
    }
  ],
  "frames": [
    {
      "id": "world",
      "parentFrameId": null,
      "kind": "world",
      "pose": {
        "translationM": [
          0.0,
          0.0,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "description": "Mundo: direito, +X frente da máquina, +Y cima, +Z lado direito do operador; metros. O chão é y = 0."
    }
  ],
  "root": {
    "partId": "chassis",
    "frameId": "world",
    "pose": {
      "translationM": [
        0.0,
        0.0,
        0.0
      ],
      "rotation": [
        0.0,
        0.0,
        0.0,
        1.0
      ],
      "provenance": {
        "translationM": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        },
        "rotation": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      }
    }
  },
  "parts": [
    {
      "id": "chassis",
      "label": "Chassis (material circulante)",
      "role": "chassis",
      "points": [
        {
          "id": "swing_axis",
          "role": "anchor",
          "positionM": [
            0.0,
            0.95,
            0.0
          ],
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "shapes": [
        {
          "id": "chassis-body",
          "kind": "box",
          "halfExtentsM": [
            1.75,
            0.45,
            1.4
          ],
          "pose": {
            "translationM": [
              0.0,
              0.45,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "both",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "upper_body",
      "label": "Corpo superior rotativo",
      "role": "upper_body",
      "points": [],
      "shapes": [
        {
          "id": "upper-body-box",
          "kind": "box",
          "halfExtentsM": [
            1.7,
            0.75,
            1.25
          ],
          "pose": {
            "translationM": [
              -0.3,
              0.75,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "both",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "boom",
      "label": "Lança",
      "role": "boom",
      "points": [
        {
          "id": "cyl_rod_pin",
          "role": "pin",
          "positionM": [
            2.2,
            -0.6,
            0.0
          ],
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "shapes": [
        {
          "id": "boom-box",
          "kind": "box",
          "halfExtentsM": [
            2.8,
            0.38,
            0.22
          ],
          "pose": {
            "translationM": [
              2.7,
              0.0,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "both",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "stick",
      "label": "Braço",
      "role": "stick",
      "points": [
        {
          "id": "cyl_rod_pin",
          "role": "pin",
          "positionM": [
            -0.4,
            0.1,
            0.0
          ],
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "shapes": [
        {
          "id": "stick-box",
          "kind": "box",
          "halfExtentsM": [
            1.5,
            0.25,
            0.15
          ],
          "pose": {
            "translationM": [
              1.35,
              -0.05,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "both",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "bucket",
      "label": "Caçamba",
      "role": "bucket",
      "points": [
        {
          "id": "link_pin",
          "role": "pin",
          "positionM": [
            -0.39,
            -0.36,
            0.0
          ],
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        {
          "id": "tip",
          "role": "tool_tip",
          "positionM": [
            1.3,
            -0.65,
            0.0
          ],
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "shapes": [
        {
          "id": "bucket-box",
          "kind": "box",
          "halfExtentsM": [
            0.75,
            0.35,
            0.55
          ],
          "pose": {
            "translationM": [
              0.55,
              -0.3,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "both",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "boom_cyl_barrel",
      "label": "Cilindro da lança · barril",
      "role": "cylinder_barrel",
      "points": [],
      "shapes": [
        {
          "id": "boom-cyl-barrel",
          "kind": "cylinder",
          "radiusM": 0.09,
          "halfLengthM": 0.654,
          "pose": {
            "translationM": [
              0.654,
              0.0,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "both",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "boom_cyl_rod",
      "label": "Cilindro da lança · haste",
      "role": "cylinder_rod",
      "points": [
        {
          "id": "end_pin",
          "role": "pin",
          "positionM": [
            0.0,
            0.0,
            0.0
          ],
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "shapes": [
        {
          "id": "boom-cyl-rod",
          "kind": "cylinder",
          "radiusM": 0.05,
          "halfLengthM": 0.7515,
          "pose": {
            "translationM": [
              -0.7515,
              0.0,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "both",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "stick_cyl_barrel",
      "label": "Cilindro do braço · barril",
      "role": "cylinder_barrel",
      "points": [],
      "shapes": [
        {
          "id": "stick-cyl-barrel",
          "kind": "cylinder",
          "radiusM": 0.09,
          "halfLengthM": 0.684,
          "pose": {
            "translationM": [
              0.684,
              0.0,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "both",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "stick_cyl_rod",
      "label": "Cilindro do braço · haste",
      "role": "cylinder_rod",
      "points": [
        {
          "id": "end_pin",
          "role": "pin",
          "positionM": [
            0.0,
            0.0,
            0.0
          ],
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "shapes": [
        {
          "id": "stick-cyl-rod",
          "kind": "cylinder",
          "radiusM": 0.05,
          "halfLengthM": 0.787,
          "pose": {
            "translationM": [
              -0.787,
              0.0,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "both",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "bucket_cyl_barrel",
      "label": "Cilindro da caçamba · barril",
      "role": "cylinder_barrel",
      "points": [],
      "shapes": [
        {
          "id": "bucket-cyl-barrel",
          "kind": "cylinder",
          "radiusM": 0.09,
          "halfLengthM": 0.663,
          "pose": {
            "translationM": [
              0.663,
              0.0,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "both",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "bucket_cyl_rod",
      "label": "Cilindro da caçamba · haste",
      "role": "cylinder_rod",
      "points": [
        {
          "id": "end_pin",
          "role": "pin",
          "positionM": [
            0.0,
            0.0,
            0.0
          ],
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "shapes": [
        {
          "id": "bucket-cyl-rod",
          "kind": "cylinder",
          "radiusM": 0.05,
          "halfLengthM": 0.724,
          "pose": {
            "translationM": [
              -0.724,
              0.0,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "both",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "idler_link",
      "label": "Balancé (idler)",
      "role": "link",
      "points": [
        {
          "id": "end",
          "role": "pin",
          "positionM": [
            0.54,
            0.0,
            0.0
          ],
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "shapes": [
        {
          "id": "idler-link-box",
          "kind": "box",
          "halfExtentsM": [
            0.27,
            0.04,
            0.1
          ],
          "pose": {
            "translationM": [
              0.27,
              0.0,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "visual",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "bucket_link",
      "label": "Barra de ligação da caçamba",
      "role": "link",
      "points": [
        {
          "id": "end",
          "role": "pin",
          "positionM": [
            0.7,
            0.0,
            0.0
          ],
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "shapes": [
        {
          "id": "bucket-link-box",
          "kind": "box",
          "halfExtentsM": [
            0.35,
            0.04,
            0.1
          ],
          "pose": {
            "translationM": [
              0.35,
              0.0,
              0.0
            ],
            "rotation": [
              0.0,
              0.0,
              0.0,
              1.0
            ],
            "provenance": {
              "translationM": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              },
              "rotation": {
                "origin": "fixture",
                "validation": "unreviewed",
                "recordedAt": "2026-11-02T00:00:00.000Z",
                "evidence": [
                  {
                    "sourceId": "src-excavator-fixture",
                    "locator": "excavator.assembly.v1",
                    "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
                  }
                ]
              }
            }
          },
          "purpose": "visual",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      ],
      "massKg": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    }
  ],
  "joints": [
    {
      "id": "swing",
      "type": "revolute",
      "parentPartId": "chassis",
      "childPartId": "upper_body",
      "origin": {
        "translationM": [
          0.0,
          0.95,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        0.0,
        1.0,
        0.0
      ],
      "limits": {
        "min": {
          "value": -3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": 0.0,
        "unit": "rad",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": {
        "positive": "swing_left",
        "negative": "swing_right"
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "boom_joint",
      "type": "revolute",
      "parentPartId": "upper_body",
      "childPartId": "boom",
      "origin": {
        "translationM": [
          0.95,
          0.55,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        0.0,
        0.0,
        1.0
      ],
      "limits": {
        "min": {
          "value": -0.55,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 1.05,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": 0.45,
        "unit": "rad",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": {
        "positive": "raise",
        "negative": "lower"
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "stick_joint",
      "type": "revolute",
      "parentPartId": "boom",
      "childPartId": "stick",
      "origin": {
        "translationM": [
          5.4,
          0.0,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        0.0,
        0.0,
        1.0
      ],
      "limits": {
        "min": {
          "value": -2.35,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": -0.3,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": -1.2,
        "unit": "rad",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": {
        "positive": "extend",
        "negative": "retract"
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "bucket_joint",
      "type": "revolute",
      "parentPartId": "stick",
      "childPartId": "bucket",
      "origin": {
        "translationM": [
          2.85,
          0.0,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        0.0,
        0.0,
        1.0
      ],
      "limits": {
        "min": {
          "value": -2.1,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 0.0,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": -0.9,
        "unit": "rad",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": {
        "positive": "dump",
        "negative": "curl"
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "boom_cyl_base",
      "type": "revolute",
      "parentPartId": "upper_body",
      "childPartId": "boom_cyl_barrel",
      "origin": {
        "translationM": [
          0.6,
          0.05,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        0.0,
        0.0,
        1.0
      ],
      "limits": {
        "min": {
          "value": -3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": 0.33992559995337435,
        "unit": "rad",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "boom_cyl_slide",
      "type": "prismatic",
      "parentPartId": "boom_cyl_barrel",
      "childPartId": "boom_cyl_rod",
      "origin": {
        "translationM": [
          2.18,
          0.0,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        1.0,
        0.0,
        0.0
      ],
      "limits": {
        "min": {
          "value": 0.0,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 0.76,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": 0.5692780826214978,
        "unit": "m",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "stick_cyl_base",
      "type": "revolute",
      "parentPartId": "boom",
      "childPartId": "stick_cyl_barrel",
      "origin": {
        "translationM": [
          2.75,
          0.62,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        0.0,
        0.0,
        1.0
      ],
      "limits": {
        "min": {
          "value": -3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": -0.08101069806015089,
        "unit": "rad",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "stick_cyl_slide",
      "type": "prismatic",
      "parentPartId": "stick_cyl_barrel",
      "childPartId": "stick_cyl_rod",
      "origin": {
        "translationM": [
          2.28,
          0.0,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        1.0,
        0.0,
        0.0
      ],
      "limits": {
        "min": {
          "value": 0.0,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 0.8,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": 0.32681002911167933,
        "unit": "m",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "bucket_cyl_base",
      "type": "revolute",
      "parentPartId": "stick",
      "childPartId": "bucket_cyl_barrel",
      "origin": {
        "translationM": [
          0.45,
          -0.63,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        0.0,
        0.0,
        1.0
      ],
      "limits": {
        "min": {
          "value": -3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": 0.2930203949629214,
        "unit": "rad",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "bucket_cyl_slide",
      "type": "prismatic",
      "parentPartId": "bucket_cyl_barrel",
      "childPartId": "bucket_cyl_rod",
      "origin": {
        "translationM": [
          2.21,
          0.0,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        1.0,
        0.0,
        0.0
      ],
      "limits": {
        "min": {
          "value": 0.0,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 0.58,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": 0.47713826785256996,
        "unit": "m",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "idler_pivot",
      "type": "revolute",
      "parentPartId": "stick",
      "childPartId": "idler_link",
      "origin": {
        "translationM": [
          2.6,
          -0.19,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        0.0,
        0.0,
        1.0
      ],
      "limits": {
        "min": {
          "value": -3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": 0.6719732084129209,
        "unit": "rad",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "link_pin",
      "type": "revolute",
      "parentPartId": "idler_link",
      "childPartId": "bucket_link",
      "origin": {
        "translationM": [
          0.54,
          0.0,
          0.0
        ],
        "rotation": [
          0.0,
          0.0,
          0.0,
          1.0
        ],
        "provenance": {
          "translationM": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          },
          "rotation": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "axis": [
        0.0,
        0.0,
        1.0
      ],
      "limits": {
        "min": {
          "value": -3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 3.141592653589793,
          "unit": "rad",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceValue": {
        "value": 2.5618201091406494,
        "unit": "rad",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "motion": null,
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    }
  ],
  "constraints": [
    {
      "id": "boom_cyl_closure",
      "kind": "coincident_points",
      "a": {
        "partId": "boom_cyl_rod",
        "pointId": "end_pin"
      },
      "b": {
        "partId": "boom",
        "pointId": "cyl_rod_pin"
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "stick_cyl_closure",
      "kind": "coincident_points",
      "a": {
        "partId": "stick_cyl_rod",
        "pointId": "end_pin"
      },
      "b": {
        "partId": "stick",
        "pointId": "cyl_rod_pin"
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "bucket_cyl_closure",
      "kind": "coincident_points",
      "a": {
        "partId": "bucket_cyl_rod",
        "pointId": "end_pin"
      },
      "b": {
        "partId": "idler_link",
        "pointId": "end"
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "bucket_link_closure",
      "kind": "coincident_points",
      "a": {
        "partId": "bucket_link",
        "pointId": "end"
      },
      "b": {
        "partId": "bucket",
        "pointId": "link_pin"
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    }
  ],
  "actuators": [
    {
      "id": "swing_drive",
      "label": "Motor de rotação",
      "kind": "rotary_drive",
      "jointId": "swing",
      "maxRate": {
        "value": 0.35,
        "unit": "rad/s",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "boom_cylinder",
      "label": "Cilindro da lança",
      "kind": "hydraulic_cylinder",
      "barrelPartId": "boom_cyl_barrel",
      "rodPartId": "boom_cyl_rod",
      "slideJointId": "boom_cyl_slide",
      "stroke": {
        "min": {
          "value": 0.0,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 0.76,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceStroke": {
        "value": 0.5692780826214978,
        "unit": "m",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "maxRate": {
        "value": 0.15,
        "unit": "m/s",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "hydraulics": {
        "boreDiameter": null,
        "rodDiameter": null,
        "supplyPressure": null
      },
      "drives": {
        "jointId": "boom_joint",
        "transmission": "direct_triangle",
        "constraintIds": [
          "boom_cyl_closure"
        ],
        "linkPartIds": []
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "stick_cylinder",
      "label": "Cilindro do braço",
      "kind": "hydraulic_cylinder",
      "barrelPartId": "stick_cyl_barrel",
      "rodPartId": "stick_cyl_rod",
      "slideJointId": "stick_cyl_slide",
      "stroke": {
        "min": {
          "value": 0.0,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 0.8,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceStroke": {
        "value": 0.32681002911167933,
        "unit": "m",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "maxRate": {
        "value": 0.15,
        "unit": "m/s",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "hydraulics": {
        "boreDiameter": null,
        "rodDiameter": null,
        "supplyPressure": null
      },
      "drives": {
        "jointId": "stick_joint",
        "transmission": "direct_triangle",
        "constraintIds": [
          "stick_cyl_closure"
        ],
        "linkPartIds": []
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    },
    {
      "id": "bucket_cylinder",
      "label": "Cilindro da caçamba",
      "kind": "hydraulic_cylinder",
      "barrelPartId": "bucket_cyl_barrel",
      "rodPartId": "bucket_cyl_rod",
      "slideJointId": "bucket_cyl_slide",
      "stroke": {
        "min": {
          "value": 0.0,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        },
        "max": {
          "value": 0.58,
          "unit": "m",
          "provenance": {
            "origin": "fixture",
            "validation": "unreviewed",
            "recordedAt": "2026-11-02T00:00:00.000Z",
            "evidence": [
              {
                "sourceId": "src-excavator-fixture",
                "locator": "excavator.assembly.v1",
                "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
              }
            ]
          }
        }
      },
      "referenceStroke": {
        "value": 0.47713826785256996,
        "unit": "m",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "maxRate": {
        "value": 0.15,
        "unit": "m/s",
        "provenance": {
          "origin": "fixture",
          "validation": "unreviewed",
          "recordedAt": "2026-11-02T00:00:00.000Z",
          "evidence": [
            {
              "sourceId": "src-excavator-fixture",
              "locator": "excavator.assembly.v1",
              "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
            }
          ]
        }
      },
      "hydraulics": {
        "boreDiameter": null,
        "rodDiameter": null,
        "supplyPressure": null
      },
      "drives": {
        "jointId": "bucket_joint",
        "transmission": "two_link_chain",
        "constraintIds": [
          "bucket_cyl_closure",
          "bucket_link_closure"
        ],
        "linkPartIds": [
          "idler_link",
          "bucket_link"
        ]
      },
      "provenance": {
        "origin": "fixture",
        "validation": "unreviewed",
        "recordedAt": "2026-11-02T00:00:00.000Z",
        "evidence": [
          {
            "sourceId": "src-excavator-fixture",
            "locator": "excavator.assembly.v1",
            "excerpt": "Dimensão escolhida para o fixture; não vem de nenhum fabricante."
          }
        ]
      }
    }
  ],
  "collision": {
    "groundPlane": {
      "yM": 0.0,
      "ignorePartIds": [
        "chassis",
        "bucket"
      ]
    },
    "ignorePairs": [],
    "onContact": "block"
  },
  "provenance": {
    "origin": "fixture",
    "validation": "unreviewed",
    "recordedAt": "2026-11-02T00:00:00.000Z",
    "evidence": [
      {
        "sourceId": "src-excavator-fixture",
        "locator": "excavator.assembly.v1",
        "excerpt": "Montagem sintética gerada por um script independente do motor; serve de dado de teste e de contrato."
      }
    ]
  }
};
