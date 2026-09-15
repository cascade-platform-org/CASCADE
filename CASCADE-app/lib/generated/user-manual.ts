// GENERATED FILE — do not edit.
// Source: docs/project/user-manual.md · Regenerate: npm run docs:manual
// The parity test in lib/manual/user-manual.test.ts fails when this is stale.

import type { ManualDoc } from "@/lib/manual/types";

export const USER_MANUAL: ManualDoc = {
  "sections": [
    {
      "id": "setting-up-an-element",
      "n": 1,
      "title": "Setting up an element",
      "blocks": [
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "Select a node or edge and fill in the Inspector — the panel on the right. An edge "
            },
            {
              "kind": "code",
              "text": "a → b"
            },
            {
              "kind": "text",
              "text": " means "
            },
            {
              "kind": "strong",
              "text": "a supplies b"
            },
            {
              "kind": "text",
              "text": ". Common attributes with nodes have the same meaning."
            }
          ]
        },
        {
          "type": "callout",
          "spans": [
            {
              "kind": "strong",
              "text": "Supply Capacity"
            },
            {
              "kind": "text",
              "text": " appears once the node carries a Category (or is a Source), "
            },
            {
              "kind": "strong",
              "text": "Category Dependency Profiles"
            },
            {
              "kind": "text",
              "text": "  appears once a Categorized node reaches it,  and "
            },
            {
              "kind": "strong",
              "text": "Canvas Membership"
            },
            {
              "kind": "text",
              "text": " once the project has a second Canvas."
            }
          ]
        },
        {
          "type": "sub",
          "title": "Identity",
          "blocks": [
            {
              "type": "table",
              "head": [
                "Field",
                "Meaning",
                "Consequence"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Label"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "The name shown on the canvas."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Rules can reference it."
                    },
                    {
                      "kind": "break"
                    },
                    {
                      "kind": "text",
                      "text": "Appears in the analysis."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Node Type"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Source / Infrastructure / Service / Personnel."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Rapid visual cues."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Categories"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "The services the node provide ("
                    },
                    {
                      "kind": "code",
                      "text": "e.g. water"
                    },
                    {
                      "kind": "text",
                      "text": ","
                    },
                    {
                      "kind": "code",
                      "text": "manager"
                    },
                    {
                      "kind": "text",
                      "text": ", …). To represent a resource flowing in a capacited infrastructure adopt "
                    },
                    {
                      "kind": "strong",
                      "text": "SourceToDemands"
                    },
                    {
                      "kind": "text",
                      "text": " Category. To represent logical interdependencies, adopt "
                    },
                    {
                      "kind": "strong",
                      "text": "Requisite"
                    },
                    {
                      "kind": "text",
                      "text": " Category."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Determines how the disservice propagates. See Section Propagation for details."
                    }
                  ]
                ]
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "Functionality",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "The element's current condition. A "
                },
                {
                  "kind": "strong",
                  "text": "Reset"
                },
                {
                  "kind": "text",
                  "text": " clears every field in this section."
                }
              ]
            },
            {
              "type": "table",
              "head": [
                "Field",
                "Meaning",
                "Consequence"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Functionality"
                    },
                    {
                      "kind": "text",
                      "text": " "
                    },
                    {
                      "kind": "code",
                      "text": "1–N"
                    }
                  ],
                  [
                    {
                      "kind": "code",
                      "text": "1"
                    },
                    {
                      "kind": "text",
                      "text": " worst, "
                    },
                    {
                      "kind": "code",
                      "text": "N"
                    },
                    {
                      "kind": "text",
                      "text": " fully operational."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Sets the colour on the canvas representing disservice. Edit it by hand to pose a what-if"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Functionality Time"
                    },
                    {
                      "kind": "text",
                      "text": " (hours)"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Hours left on a backup that is preserving the functionality."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "When above zero the node keeps its functionality but pulses with an amber ring on the canvas. The countdown moves only on a"
                    },
                    {
                      "kind": "strong",
                      "text": "Temporal Jump"
                    },
                    {
                      "kind": "text",
                      "text": " ; at zero the element drops to "
                    },
                    {
                      "kind": "code",
                      "text": "1"
                    },
                    {
                      "kind": "text",
                      "text": "."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Direct damage"
                    },
                    {
                      "kind": "text",
                      "text": " (physical breakage)"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "The element is broken requiring intervention."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Set by an "
                    },
                    {
                      "kind": "strong",
                      "text": "Hazard"
                    },
                    {
                      "kind": "text",
                      "text": ", or by hand. It draws a crack on the node and it is considered in the repair ranking"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Expected repair time"
                    },
                    {
                      "kind": "text",
                      "text": " (hours)"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "An estimated time for fixing."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Feeds the repair ranking's value-per-hour; it doesn't propagate."
                    }
                  ]
                ]
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "Capacities",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "What the node can "
                },
                {
                  "kind": "strong",
                  "text": "produce"
                },
                {
                  "kind": "text",
                  "text": " and what it can "
                },
                {
                  "kind": "strong",
                  "text": "pass on"
                },
                {
                  "kind": "text",
                  "text": " — two different numbers, both read by the flow propagation (§2.2)."
                }
              ]
            },
            {
              "type": "table",
              "head": [
                "Field",
                "Meaning",
                "Consequence"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Supply Capacity"
                    },
                    {
                      "kind": "text",
                      "text": " "
                    },
                    {
                      "kind": "code",
                      "text": "{category: amount}"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "The amount of demand the node can supply to the same-category nodes. Makes the node a source of that category."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Scaled by its current functionality. See Section Propagation for details."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Throughput Capacity"
                    },
                    {
                      "kind": "text",
                      "text": " (per category)"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "How much can pass "
                    },
                    {
                      "kind": "strong",
                      "text": "through"
                    },
                    {
                      "kind": "text",
                      "text": " the node on its way elsewhere. Shown for "
                    },
                    {
                      "kind": "code",
                      "text": "SourceToDemands"
                    },
                    {
                      "kind": "text",
                      "text": " categories only."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Scaled by its current functionality, exactly like an edge. Left empty it defaults to the largest supply declared for that category — finite, so a degraded node still throttles."
                    }
                  ]
                ]
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "Socioeconomic Values",
          "blocks": [
            {
              "type": "table",
              "head": [
                "Field",
                "Meaning",
                "Consequence"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Importance"
                    },
                    {
                      "kind": "text",
                      "text": " "
                    },
                    {
                      "kind": "code",
                      "text": "0–1"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "How much this node counts. Defaults to"
                    },
                    {
                      "kind": "strong",
                      "text": "0.5"
                    },
                    {
                      "kind": "text",
                      "text": "."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "No effect on propagation. It sets the size the node is drawn at, can weight the analysis results."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Cost of disservice / day"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Money lost per day while degraded."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Can weight the analysis results."
                    }
                  ]
                ]
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "Category Dependency Profiles",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Appears as one block per Category reaching the node."
                }
              ]
            },
            {
              "type": "table",
              "head": [
                "Field",
                "Meaning",
                "Consequence"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Dependency level"
                    },
                    {
                      "kind": "text",
                      "text": " "
                    },
                    {
                      "kind": "code",
                      "text": "1–N"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "How hard a parent-node disservice affects the node."
                    }
                  ],
                  [
                    {
                      "kind": "code",
                      "text": "N"
                    },
                    {
                      "kind": "text",
                      "text": " (the default) represents the maximum dependency. "
                    },
                    {
                      "kind": "code",
                      "text": "1"
                    },
                    {
                      "kind": "text",
                      "text": " means this category can never degrade the node."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Has backup"
                    },
                    {
                      "kind": "text",
                      "text": " + "
                    },
                    {
                      "kind": "strong",
                      "text": "Backup duration (hours)"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "The node holds its current functionality (instead of degrading), and starts a countdown."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "The drop can be triggered via a "
                    },
                    {
                      "kind": "strong",
                      "text": "Temporal Jump"
                    },
                    {
                      "kind": "text",
                      "text": ". On expiry the node goes straight to critical."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Demand"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "The quantity, per-category, the node requires and consumes in the flow propagation."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Only nodes with"
                    },
                    {
                      "kind": "code",
                      "text": "demand > 0"
                    },
                    {
                      "kind": "text",
                      "text": " are considered in the flow allocation."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Priority"
                    },
                    {
                      "kind": "text",
                      "text": " "
                    },
                    {
                      "kind": "code",
                      "text": "1–10"
                    },
                    {
                      "kind": "text",
                      "text": " (default 5)"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Who gets served first when supply is insufficient."
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Only used by"
                    },
                    {
                      "kind": "code",
                      "text": "SourceToDemands"
                    },
                    {
                      "kind": "text",
                      "text": " categories. Equal priorities share the shortage; a higher priority takes its full demand before lower ones get anything."
                    }
                  ]
                ]
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "Vulnerability Levels",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "One entry per Event, on nodes and on edges. It sets how the Event affects the element."
                }
              ]
            },
            {
              "type": "table",
              "head": [
                "Vulnerability",
                "At N=3"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "text",
                      "text": "absent or 0"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "untouched by that Event"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "text",
                      "text": "1"
                    }
                  ],
                  [
                    {
                      "kind": "code",
                      "text": "operational_warning"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "text",
                      "text": "2"
                    }
                  ],
                  [
                    {
                      "kind": "code",
                      "text": "critical"
                    }
                  ]
                ]
              ]
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Hazard Events can also activate the element's "
                },
                {
                  "kind": "strong",
                  "text": "Direct damage"
                },
                {
                  "kind": "text",
                  "text": "."
                }
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "Rules",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "The rules targetting this element which customize the propagation. See Section Rules for details."
                }
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "Properties",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Free key/value attributes carried with the element — a population, an asset code, a pressure. Numeric ones become weighting options for the Operativity Score, and Rules can read them. The engine ignores the rest."
                }
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "Canvas Membership",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Shown once the project has a second Canvas: pick a "
                },
                {
                  "kind": "strong",
                  "text": "Target canvas"
                },
                {
                  "kind": "text",
                  "text": ", then "
                },
                {
                  "kind": "strong",
                  "text": "Copy"
                },
                {
                  "kind": "text",
                  "text": "  or "
                },
                {
                  "kind": "strong",
                  "text": "Move"
                },
                {
                  "kind": "text",
                  "text": " to another Canvas. The same element can be shown on two Canvases through the "
                },
                {
                  "kind": "strong",
                  "text": "Copy"
                },
                {
                  "kind": "text",
                  "text": " button."
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "propagation",
      "n": 2,
      "title": "Propagation",
      "blocks": [
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "A Propagation asks one question: given what is damaged now, what else stops working? It runs on the server, in rounds, until no element worsens further."
            }
          ]
        },
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "Each round, each element: "
            },
            {
              "kind": "strong",
              "text": "propose → guard → commit"
            },
            {
              "kind": "text",
              "text": "."
            }
          ]
        },
        {
          "type": "table",
          "head": [
            "Phase",
            "What happens",
            "Steered by"
          ],
          "rows": [
            [
              [
                {
                  "kind": "strong",
                  "text": "Propose"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "Two passes compute a candidate Functionality; the worse of the two is kept."
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "Categories, edges, Supply Capacity, Demand"
                }
              ]
            ],
            [
              [
                {
                  "kind": "strong",
                  "text": "Guard"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "The candidate is attenuated, deferred, or overridden."
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "Dependency level, Has backup, Specific rules"
                }
              ]
            ],
            [
              [
                {
                  "kind": "strong",
                  "text": "Commit"
                }
              ],
              [
                {
                  "kind": "code",
                  "text": "worst_of(current, candidate)"
                },
                {
                  "kind": "text",
                  "text": " — a run only degrades, never repairs."
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "—"
                }
              ]
            ]
          ]
        },
        {
          "type": "sub",
          "title": "2.1 Propose — the Requisite pass",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Runs for "
                },
                {
                  "kind": "strong",
                  "text": "every"
                },
                {
                  "kind": "text",
                  "text": " element, every round, whatever Category Types are involved. It answers \"is what I need still there?\" without counting quantities."
                }
              ]
            },
            {
              "type": "list",
              "ordered": true,
              "items": [
                [
                  {
                    "kind": "text",
                    "text": "Each incoming edge "
                  },
                  {
                    "kind": "code",
                    "text": "u → v"
                  },
                  {
                    "kind": "text",
                    "text": " delivers "
                  },
                  {
                    "kind": "code",
                    "text": "worst_of(u functionality, edge functionality)"
                  },
                  {
                    "kind": "text",
                    "text": "."
                  }
                ],
                [
                  {
                    "kind": "text",
                    "text": "Deliveries are grouped by the category of the parent that sent them."
                  }
                ],
                [
                  {
                    "kind": "strong",
                    "text": "Within a category: `best_of`"
                  },
                  {
                    "kind": "text",
                    "text": " — suppliers of the same service are alternatives, one healthy supplier is enough."
                  }
                ],
                [
                  {
                    "kind": "strong",
                    "text": "Across categories: `worst_of`"
                  },
                  {
                    "kind": "text",
                    "text": " — different services are all required."
                  }
                ]
              ]
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "So a node fed by two power stations survives losing one; a node fed by power "
                },
                {
                  "kind": "em",
                  "text": "and"
                },
                {
                  "kind": "text",
                  "text": " water follows whichever of the two is worse."
                }
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "2.2 Propose — the flow pass",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Runs "
                },
                {
                  "kind": "strong",
                  "text": "in addition"
                },
                {
                  "kind": "text",
                  "text": " for elements with "
                },
                {
                  "kind": "code",
                  "text": "Demand > 0"
                },
                {
                  "kind": "text",
                  "text": " in a "
                },
                {
                  "kind": "code",
                  "text": "SourceToDemands"
                },
                {
                  "kind": "text",
                  "text": " category. It answers \"how much actually arrives?\"."
                }
              ]
            },
            {
              "type": "list",
              "ordered": false,
              "items": [
                [
                  {
                    "kind": "text",
                    "text": "Supply is allocated from every source of that category through the graph at once, limited by each source's "
                  },
                  {
                    "kind": "strong",
                    "text": "Supply Capacity"
                  },
                  {
                    "kind": "text",
                    "text": " and by the "
                  },
                  {
                    "kind": "strong",
                    "text": "Throughput Capacity"
                  },
                  {
                    "kind": "text",
                    "text": " of every node and edge it passes through."
                  }
                ],
                [
                  {
                    "kind": "text",
                    "text": "A degraded element passes less: the top level passes 100 %, the bottom level 0 %, and each level in between "
                  },
                  {
                    "kind": "code",
                    "text": "(functionality − 0.5) / N"
                  },
                  {
                    "kind": "text",
                    "text": " of its capacity."
                  }
                ],
                [
                  {
                    "kind": "text",
                    "text": "When supply is short, "
                  },
                  {
                    "kind": "strong",
                    "text": "Priority"
                  },
                  {
                    "kind": "text",
                    "text": " decides who is served first. Equal priorities share the shortfall fairly; a higher priority is served in full before lower ones get anything."
                  }
                ],
                [
                  {
                    "kind": "text",
                    "text": "The served ratio becomes a level: "
                  },
                  {
                    "kind": "code",
                    "text": "max(1, ⌈delivered / demand × N⌉)"
                  },
                  {
                    "kind": "text",
                    "text": ". Fully served → "
                  },
                  {
                    "kind": "code",
                    "text": "N"
                  },
                  {
                    "kind": "text",
                    "text": "; nothing delivered → "
                  },
                  {
                    "kind": "code",
                    "text": "1"
                  },
                  {
                    "kind": "text",
                    "text": "."
                  }
                ]
              ]
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "An element with no Demand is untouched by this pass. An element with both passes active takes the worse of the two."
                }
              ]
            },
            {
              "type": "table",
              "head": [
                "Category Type",
                "Question it answers",
                "Reads"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Requisite"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Is the service present?"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "edges, parent Functionality"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "SourceToDemands"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Is there enough of it?"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Supply Capacity, Throughput Capacity, Demand, Priority"
                    }
                  ]
                ]
              ]
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "code",
                  "text": "SourceToDemands"
                },
                {
                  "kind": "text",
                  "text": " elements are subject to the Requisite pass as well — quantity does not replace presence."
                }
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "2.3 Guard — in this fixed order",
          "blocks": [
            {
              "type": "list",
              "ordered": true,
              "items": [
                [
                  {
                    "kind": "strong",
                    "text": "Dependency level."
                  },
                  {
                    "kind": "text",
                    "text": " "
                  },
                  {
                    "kind": "code",
                    "text": "candidate + (N − dependency level)"
                  },
                  {
                    "kind": "text",
                    "text": ", never above the element's current level. "
                  },
                  {
                    "kind": "code",
                    "text": "N"
                  },
                  {
                    "kind": "text",
                    "text": " passes the drop whole, "
                  },
                  {
                    "kind": "code",
                    "text": "1"
                  },
                  {
                    "kind": "text",
                    "text": " cancels it, intermediate values soften it by that many levels."
                  }
                ],
                [
                  {
                    "kind": "strong",
                    "text": "Has backup"
                  },
                  {
                    "kind": "text",
                    "text": ", per category. A proposed drop coming from a backed category is not applied: its duration is written to "
                  },
                  {
                    "kind": "strong",
                    "text": "Functionality Time"
                  },
                  {
                    "kind": "text",
                    "text": " and the drop waits for a "
                  },
                  {
                    "kind": "strong",
                    "text": "Temporal Jump"
                  },
                  {
                    "kind": "text",
                    "text": ". A drop coming from an "
                  },
                  {
                    "kind": "em",
                    "text": "unbacked"
                  },
                  {
                    "kind": "text",
                    "text": " category still commits this round — a reserve for water does not keep the power on. With several backups running, the shortest countdown wins, and an existing countdown is only ever shortened."
                  }
                ],
                [
                  {
                    "kind": "strong",
                    "text": "Specific rules"
                  },
                  {
                    "kind": "text",
                    "text": " — highest priority. A firing rule replaces the result and overrides both the attenuation and the backup deferral; a rule-forced critical goes critical now, and the pending countdown is cleared."
                  }
                ]
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "2.4 Commit and convergence",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "The element takes "
                },
                {
                  "kind": "code",
                  "text": "worst_of(current, result)"
                },
                {
                  "kind": "text",
                  "text": ". Within one run Functionality only falls — nothing recovers, which is what makes the rounds terminate. Rounds repeat until no element worsens."
                }
              ]
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "On a large model the engine may stop early and return "
                },
                {
                  "kind": "code",
                  "text": "convergence not reached"
                },
                {
                  "kind": "text",
                  "text": " as a warning. The partial result is merged like any other: it can be read, undone, and saved to the Scorecard."
                }
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "2.5 Causality",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Every degraded element records a "
                },
                {
                  "kind": "strong",
                  "text": "responsibility share"
                },
                {
                  "kind": "text",
                  "text": " — who caused this, and in what proportion — taken from the mechanism that produced its final level. The Inspector states it in words, and the repair ranking is computed from it."
                }
              ]
            },
            {
              "type": "table",
              "head": [
                "Mechanism",
                "Blame goes to"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "text",
                      "text": "Requisite pass"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "the failed upstream elements, split evenly"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "text",
                      "text": "Flow pass"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "the degraded same-category elements feeding it"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "text",
                      "text": "Event"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "the Event"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "text",
                      "text": "Specific rule"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "the elements the rule names, split evenly"
                    }
                  ]
                ]
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "2.6 Scope",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "em",
                  "text": "Local"
                },
                {
                  "kind": "text",
                  "text": " propagates the active Canvas only and ignores edges leaving it; "
                },
                {
                  "kind": "em",
                  "text": "Global"
                },
                {
                  "kind": "text",
                  "text": " propagates every Canvas and follows them. "
                },
                {
                  "kind": "strong",
                  "text": "An inter-canvas cascade appears only under Global."
                },
                {
                  "kind": "text",
                  "text": " The scope selector sits on the Propagate button."
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "rules",
      "n": 3,
      "title": "Rules",
      "blocks": [
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "Rules cover what the graph alone cannot express. The grammar reference is the "
            },
            {
              "kind": "link",
              "text": "Rules Manual",
              "href": "cascade:rules-manual"
            },
            {
              "kind": "text",
              "text": " window in the app; this is about when and why."
            }
          ]
        },
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "Write them in the "
            },
            {
              "kind": "strong",
              "text": "Active Rules"
            },
            {
              "kind": "text",
              "text": " window — the Inspector's "
            },
            {
              "kind": "em",
              "text": "Add rule"
            },
            {
              "kind": "text",
              "text": " opens it, and so does the Rules counter in the status bar. It suggests names, operators and levels as you type, and aims at whatever element is selected. The dropdown in its header picks which canvas's rules you are looking at, starting on the one you are on; "
            },
            {
              "kind": "em",
              "text": "All canvases"
            },
            {
              "kind": "text",
              "text": " shows every rule in the project."
            }
          ]
        },
        {
          "type": "sub",
          "title": "3.1 When you need one",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Without any rule the engine already assumes (§2):"
                }
              ]
            },
            {
              "type": "list",
              "ordered": false,
              "items": [
                [
                  {
                    "kind": "text",
                    "text": "several suppliers of the "
                  },
                  {
                    "kind": "strong",
                    "text": "same"
                  },
                  {
                    "kind": "text",
                    "text": " category → "
                  },
                  {
                    "kind": "strong",
                    "text": "best of"
                  },
                  {
                    "kind": "text",
                    "text": " them;"
                  }
                ],
                [
                  {
                    "kind": "text",
                    "text": "several "
                  },
                  {
                    "kind": "strong",
                    "text": "different"
                  },
                  {
                    "kind": "text",
                    "text": " categories → "
                  },
                  {
                    "kind": "strong",
                    "text": "worst of"
                  },
                  {
                    "kind": "text",
                    "text": " them;"
                  }
                ],
                [
                  {
                    "kind": "text",
                    "text": "partial tolerance is "
                  },
                  {
                    "kind": "code",
                    "text": "Dependency level"
                  },
                  {
                    "kind": "text",
                    "text": ", not a rule;"
                  }
                ],
                [
                  {
                    "kind": "text",
                    "text": "a delayed failure is "
                  },
                  {
                    "kind": "code",
                    "text": "Has backup"
                  },
                  {
                    "kind": "text",
                    "text": ", not a rule."
                  }
                ]
              ]
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Write a rule when the real system contradicts one of those. Many rules usually means the model wants a different Category Type or an extra element instead."
                }
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "3.2 The three kinds",
          "blocks": [
            {
              "type": "table",
              "head": [
                "Kind",
                "Shape",
                "What it changes"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Intracategorical"
                    }
                  ],
                  [
                    {
                      "kind": "code",
                      "text": "op(a, b, …) propagates to target"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "how the target combines suppliers "
                    },
                    {
                      "kind": "strong",
                      "text": "within one"
                    },
                    {
                      "kind": "text",
                      "text": " category"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Intercategorical"
                    }
                  ],
                  [
                    {
                      "kind": "code",
                      "text": "op(cat1, cat2, …) propagates to target"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "how the target combines its "
                    },
                    {
                      "kind": "strong",
                      "text": "different"
                    },
                    {
                      "kind": "text",
                      "text": " categories"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "strong",
                      "text": "Specific"
                    }
                  ],
                  [
                    {
                      "kind": "code",
                      "text": "if <condition> then <target> is <level>"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "forces an outcome when a named situation holds"
                    }
                  ]
                ]
              ]
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "The kind is inferred: starting with "
                },
                {
                  "kind": "code",
                  "text": "if"
                },
                {
                  "kind": "text",
                  "text": " makes it Specific; otherwise naming a "
                },
                {
                  "kind": "strong",
                  "text": "category"
                },
                {
                  "kind": "text",
                  "text": " in the arguments makes it Intercategorical, else Intracategorical. The target takes no category suffix."
                }
              ]
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Operators: "
                },
                {
                  "kind": "code",
                  "text": "worst_of"
                },
                {
                  "kind": "text",
                  "text": ", "
                },
                {
                  "kind": "code",
                  "text": "best_of"
                },
                {
                  "kind": "text",
                  "text": ", "
                },
                {
                  "kind": "code",
                  "text": "average_of"
                },
                {
                  "kind": "text",
                  "text": ", "
                },
                {
                  "kind": "code",
                  "text": "median_of"
                },
                {
                  "kind": "text",
                  "text": ", "
                },
                {
                  "kind": "code",
                  "text": "majority_of"
                },
                {
                  "kind": "text",
                  "text": "."
                }
              ]
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Conditions take "
                },
                {
                  "kind": "code",
                  "text": "and"
                },
                {
                  "kind": "text",
                  "text": " / "
                },
                {
                  "kind": "code",
                  "text": "or"
                },
                {
                  "kind": "text",
                  "text": " / "
                },
                {
                  "kind": "code",
                  "text": "not"
                },
                {
                  "kind": "text",
                  "text": ", parentheses, any attribute after a dot (default "
                },
                {
                  "kind": "code",
                  "text": "functionality"
                },
                {
                  "kind": "text",
                  "text": "), and "
                },
                {
                  "kind": "code",
                  "text": "< <= > >= = ≠"
                },
                {
                  "kind": "text",
                  "text": "."
                }
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "3.3 Examples",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "strong",
                  "text": "Degrade gradually instead of all-or-nothing."
                },
                {
                  "kind": "text",
                  "text": " A city has three road approaches. The default keeps it fully connected while any one is open; real traffic congests as routes close:"
                }
              ]
            },
            {
              "type": "code",
              "text": "average_of(Udine Access, Aquileia Access, Cividale Access)\n  propagates to Palmanova transport"
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "One route "
                },
                {
                  "kind": "code",
                  "text": "critical"
                },
                {
                  "kind": "text",
                  "text": ", two "
                },
                {
                  "kind": "code",
                  "text": "operational"
                },
                {
                  "kind": "text",
                  "text": " → "
                },
                {
                  "kind": "code",
                  "text": "⌊(1+3+3)/3⌋ = 2"
                },
                {
                  "kind": "text",
                  "text": "."
                }
              ]
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "strong",
                  "text": "Let one service cover for another."
                },
                {
                  "kind": "text",
                  "text": " A town copes with losing power "
                },
                {
                  "kind": "em",
                  "text": "or"
                },
                {
                  "kind": "text",
                  "text": " water while the roads are open; it fails only when transport is impaired "
                },
                {
                  "kind": "strong",
                  "text": "and"
                },
                {
                  "kind": "text",
                  "text": " one utility is too:"
                }
              ]
            },
            {
              "type": "code",
              "text": "worst_of(\n  best_of(Jalmicco electric, Jalmicco transport),\n  best_of(Jalmicco water,    Jalmicco transport)\n) propagates to Jalmicco"
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "strong",
                  "text": "Hold an element up under a standing agreement."
                },
                {
                  "kind": "text",
                  "text": " A water source depends on power, but a protocol between the two operators keeps it running while both are functioning:"
                }
              ]
            },
            {
              "type": "code",
              "text": "if water Operator.protocol_active is True\nand water Operator is operational\nand electric Operator is operational\nthen Fauglis water Source is operational"
            },
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "The first condition reads a custom attribute added under "
                },
                {
                  "kind": "strong",
                  "text": "Properties"
                },
                {
                  "kind": "text",
                  "text": "; the others read live Functionality. When either operator degrades the rule stops firing and normal propagation takes over."
                }
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "3.4 What bites people",
          "blocks": [
            {
              "type": "list",
              "ordered": false,
              "items": [
                [
                  {
                    "kind": "text",
                    "text": "A rule that would "
                  },
                  {
                    "kind": "strong",
                    "text": "improve"
                  },
                  {
                    "kind": "text",
                    "text": " an element does nothing: the commit is "
                  },
                  {
                    "kind": "code",
                    "text": "worst_of"
                  },
                  {
                    "kind": "text",
                    "text": " (§2.4)."
                  }
                ],
                [
                  {
                    "kind": "text",
                    "text": "In an intracategorical rule the listed elements only "
                  },
                  {
                    "kind": "strong",
                    "text": "select the category"
                  },
                  {
                    "kind": "text",
                    "text": " — the operator then governs "
                  },
                  {
                    "kind": "em",
                    "text": "all"
                  },
                  {
                    "kind": "text",
                    "text": " of the target's suppliers in it. Name the category directly to be unambiguous: "
                  },
                  {
                    "kind": "code",
                    "text": "worst_of(water) propagates to tank"
                  },
                  {
                    "kind": "text",
                    "text": "."
                  }
                ],
                [
                  {
                    "kind": "text",
                    "text": "A misspelt level label or an unknown element name makes the rule "
                  },
                  {
                    "kind": "strong",
                    "text": "ignored with a warning"
                  },
                  {
                    "kind": "text",
                    "text": ", not an error. Read the warnings after a Propagation."
                  }
                ]
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "running-a-scenario",
      "n": 4,
      "title": "Running a scenario",
      "blocks": [
        {
          "type": "list",
          "ordered": true,
          "items": [
            [
              {
                "kind": "strong",
                "text": "Define the Event"
              },
              {
                "kind": "text",
                "text": " in Config → Events, as a "
              },
              {
                "kind": "strong",
                "text": "Hazard"
              },
              {
                "kind": "text",
                "text": " (physical damage, needs repair) or a "
              },
              {
                "kind": "strong",
                "text": "Disservice"
              },
              {
                "kind": "text",
                "text": " (no damage, clears with its cause). Set "
              },
              {
                "kind": "code",
                "text": "Vulnerability levels"
              },
              {
                "kind": "text",
                "text": " on the exposed elements."
              }
            ],
            [
              {
                "kind": "strong",
                "text": "Pick the scope"
              },
              {
                "kind": "text",
                "text": " — "
              },
              {
                "kind": "em",
                "text": "Local"
              },
              {
                "kind": "text",
                "text": " or "
              },
              {
                "kind": "em",
                "text": "Global"
              },
              {
                "kind": "text",
                "text": " (§2.6)."
              }
            ],
            [
              {
                "kind": "strong",
                "text": "Apply"
              },
              {
                "kind": "text",
                "text": " the Event. Several can be stacked before propagating."
              }
            ],
            [
              {
                "kind": "strong",
                "text": "Propagate."
              }
            ],
            [
              {
                "kind": "strong",
                "text": "Advance time"
              },
              {
                "kind": "text",
                "text": " if anything is on backup: "
              },
              {
                "kind": "strong",
                "text": "Temporal Jump"
              },
              {
                "kind": "text",
                "text": " moves the clock by hand, "
              },
              {
                "kind": "em",
                "text": "Auto-advance"
              },
              {
                "kind": "text",
                "text": " jumps to the next expiry and re-propagates until nothing is left holding."
              }
            ]
          ]
        },
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "strong",
              "text": "Reset"
            },
            {
              "kind": "text",
              "text": " ends the scenario and hands back a working network: every element goes to full Functionality, with no countdown and no damage, whatever put it there. It also reverts what Events and Propagations wrote beyond Functionality — an attribute set by a rule, for instance — ends any temporal-jump run, and clears the Analysis Heatmap, whose colours describe a scenario that no longer exists."
            }
          ]
        },
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "Model edits are yours and survive: a renamed element, a moved node, a corrected capacity. One consequence worth knowing: an element deliberately authored below full Functionality as its "
            },
            {
              "kind": "em",
              "text": "normal"
            },
            {
              "kind": "text",
              "text": " state is raised to full as well. Reset guarantees a working network rather than reconstructing a past one."
            }
          ]
        }
      ]
    },
    {
      "id": "testing-an-intervention",
      "n": 5,
      "title": "Testing an intervention",
      "blocks": [
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "An intervention is a model edit, re-run and compared against a Scorecard entry saved from the baseline. Save before, edit, propagate, save after."
            }
          ]
        },
        {
          "type": "table",
          "head": [
            "Intervention",
            "Set"
          ],
          "rows": [
            [
              [
                {
                  "kind": "text",
                  "text": "Physical hardening"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "remove that element's "
                },
                {
                  "kind": "code",
                  "text": "Vulnerability levels"
                },
                {
                  "kind": "text",
                  "text": " entry"
                }
              ]
            ],
            [
              [
                {
                  "kind": "text",
                  "text": "Preparedness protocol"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "a Specific rule"
                }
              ]
            ],
            [
              [
                {
                  "kind": "text",
                  "text": "Load-shedding agreement"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "raise "
                },
                {
                  "kind": "code",
                  "text": "Priority"
                },
                {
                  "kind": "text",
                  "text": " on the protected consumer"
                }
              ]
            ],
            [
              [
                {
                  "kind": "text",
                  "text": "New backup"
                }
              ],
              [
                {
                  "kind": "code",
                  "text": "Has backup"
                },
                {
                  "kind": "text",
                  "text": " + "
                },
                {
                  "kind": "code",
                  "text": "Backup duration"
                }
              ]
            ],
            [
              [
                {
                  "kind": "text",
                  "text": "More headroom"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "raise "
                },
                {
                  "kind": "code",
                  "text": "Supply Capacity"
                },
                {
                  "kind": "text",
                  "text": ", or the "
                },
                {
                  "kind": "code",
                  "text": "Throughput Capacity"
                },
                {
                  "kind": "text",
                  "text": " of the limiting node or edge"
                }
              ]
            ]
          ]
        },
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "The "
            },
            {
              "kind": "strong",
              "text": "Repair"
            },
            {
              "kind": "text",
              "text": " panel ranks what to fix first: only directly damaged elements can be repaired, and each is scored by the Operativity it would return along its responsibility chains (§2.5), and again per repair hour."
            }
          ]
        }
      ]
    },
    {
      "id": "analysis-results",
      "n": 6,
      "title": "Analysis results",
      "blocks": [
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "The Analysis window scores every element. It floats over the canvas — drag its title bar to move it, its edges to resize it, and the − button to roll it up when you want the canvas back."
            }
          ]
        },
        {
          "type": "table",
          "head": [
            "Family",
            "Examples",
            "Cost"
          ],
          "rows": [
            [
              [
                {
                  "kind": "strong",
                  "text": "Topological"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "betweenness, reachability, communities"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "runs in the browser, instant"
                }
              ]
            ],
            [
              [
                {
                  "kind": "strong",
                  "text": "Model-based"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "Vitality, Shapley"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "re-runs the engine once per element or coalition — needs the server"
                }
              ]
            ]
          ]
        },
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "The panel shows the engine call count before a model-based run starts, and Cancel keeps whatever it has computed."
            }
          ]
        },
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "strong",
              "text": "OI node weight"
            },
            {
              "kind": "text",
              "text": " decides which node attribute weights the Operativity Score. Changing it re-scores the result already computed — no new engine calls, nothing lost — so several weightings can be tried on one expensive run."
            }
          ]
        },
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "Scores are painted onto the elements as soon as the metric finishes. The canvas legend swaps its Functionality scale for the metric's own key, because the colours no longer mean Functionality. The overlay stays until "
            },
            {
              "kind": "strong",
              "text": "Clear heatmap"
            },
            {
              "kind": "text",
              "text": " or a Reset; closing the Analysis window leaves it alone, and the Analyse button carries a dot while a heatmap is live."
            }
          ]
        },
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "After a Shapley run, "
            },
            {
              "kind": "strong",
              "text": "Export Shapley values (JSON)"
            },
            {
              "kind": "text",
              "text": " saves one φ̂ per element plus the seed the run used, so the same estimate can be replayed later."
            }
          ]
        }
      ]
    },
    {
      "id": "saving-and-loading",
      "n": 7,
      "title": "Saving and loading",
      "blocks": [
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "The "
            },
            {
              "kind": "strong",
              "text": "File"
            },
            {
              "kind": "text",
              "text": " button in the Topbar opens four tabs."
            }
          ]
        },
        {
          "type": "table",
          "head": [
            "Tab",
            "What it does"
          ],
          "rows": [
            [
              [
                {
                  "kind": "strong",
                  "text": "Local"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "Save to your computer, open a "
                },
                {
                  "kind": "code",
                  "text": ".json"
                },
                {
                  "kind": "text",
                  "text": " file, and the last 10 saves kept in this browser. Plus a backup folder, written to every time you close the tab."
                }
              ]
            ],
            [
              [
                {
                  "kind": "strong",
                  "text": "Cloud"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "Save to your account and open it on any device. Last 10 kept. Needs sign-in with Sync."
                }
              ]
            ],
            [
              [
                {
                  "kind": "strong",
                  "text": "Import"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "Build a project from an EPANET "
                },
                {
                  "kind": "code",
                  "text": ".inp"
                },
                {
                  "kind": "text",
                  "text": " file."
                }
              ]
            ],
            [
              [
                {
                  "kind": "strong",
                  "text": "New"
                }
              ],
              [
                {
                  "kind": "text",
                  "text": "Start a fresh project. The current one stays open until the setup is finished, so Cancel costs nothing."
                }
              ]
            ]
          ]
        },
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "Local and cloud saves are independent: clearing the browser does not touch the cloud saves, and deleting a cloud save does not touch the computer."
            }
          ]
        },
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "strong",
              "text": "Auto-save"
            },
            {
              "kind": "text",
              "text": " (Cloud tab) keeps one spare copy that updates as you work. It never replaces one of the 10 cloud saves. Switching it off deletes it."
            }
          ]
        }
      ]
    },
    {
      "id": "server-and-roles",
      "n": 8,
      "title": "Server and roles",
      "blocks": [
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "strong",
              "text": "Propagate"
            },
            {
              "kind": "text",
              "text": " and the model-based analyses (Shapley, Vitality) need the server and "
            },
            {
              "kind": "code",
              "text": "can_propagate"
            },
            {
              "kind": "text",
              "text": " — "
            },
            {
              "kind": "code",
              "text": "analyst"
            },
            {
              "kind": "text",
              "text": " and above. "
            },
            {
              "kind": "strong",
              "text": "Sync"
            },
            {
              "kind": "text",
              "text": " needs "
            },
            {
              "kind": "code",
              "text": "can_sync"
            },
            {
              "kind": "text",
              "text": ". Everything else, including topological analysis, works offline. Roles also carry a node cap and an engine-evaluation budget per minute."
            }
          ]
        }
      ]
    },
    {
      "id": "keyboard-shortcuts",
      "n": 9,
      "title": "Keyboard shortcuts",
      "blocks": [
        {
          "type": "paragraph",
          "spans": [
            {
              "kind": "text",
              "text": "Every shortcut the editor listens for. They are ignored while you are typing in a text field, so they never fight the Inspector. "
            },
            {
              "kind": "code",
              "text": "Ctrl"
            },
            {
              "kind": "text",
              "text": " is "
            },
            {
              "kind": "code",
              "text": "⌘"
            },
            {
              "kind": "text",
              "text": " on macOS."
            }
          ]
        },
        {
          "type": "sub",
          "title": "Editing",
          "blocks": [
            {
              "type": "table",
              "head": [
                "Key",
                "Does"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "code",
                      "text": "Ctrl+Z"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Undo the last change to the network."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "code",
                      "text": "Ctrl+Y"
                    },
                    {
                      "kind": "text",
                      "text": " or "
                    },
                    {
                      "kind": "code",
                      "text": "Ctrl+Shift+Z"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Redo."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "code",
                      "text": "Ctrl+A"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Select every element on the current Canvas, and open the Inspector."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "code",
                      "text": "Ctrl+C"
                    },
                    {
                      "kind": "text",
                      "text": " / "
                    },
                    {
                      "kind": "code",
                      "text": "Ctrl+V"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Copy the selection, and paste it onto the active Canvas."
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "code",
                      "text": "Delete"
                    },
                    {
                      "kind": "text",
                      "text": " or "
                    },
                    {
                      "kind": "code",
                      "text": "Backspace"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Delete the selected nodes and edges."
                    }
                  ]
                ]
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "Scenario",
          "blocks": [
            {
              "type": "table",
              "head": [
                "Key",
                "Does"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "code",
                      "text": "Ctrl+R"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Clear the most recently applied Event, and the cascade computed from it — a Propagation whose Event is gone describes nothing. Other Events stay applied but un-propagated; re-run Propagation for the new cascade. Your own edits are untouched, and "
                    },
                    {
                      "kind": "code",
                      "text": "Ctrl+Z"
                    },
                    {
                      "kind": "text",
                      "text": " brings the Event and its cascade back. It takes over the browser's reload shortcut while the canvas has focus; use "
                    },
                    {
                      "kind": "code",
                      "text": "F5"
                    },
                    {
                      "kind": "text",
                      "text": " to reload."
                    }
                  ]
                ]
              ]
            }
          ]
        },
        {
          "type": "sub",
          "title": "View and tools",
          "blocks": [
            {
              "type": "paragraph",
              "spans": [
                {
                  "kind": "text",
                  "text": "Single letters, no modifier."
                }
              ]
            },
            {
              "type": "table",
              "head": [
                "Key",
                "Does"
              ],
              "rows": [
                [
                  [
                    {
                      "kind": "code",
                      "text": "V"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Select tool"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "code",
                      "text": "N"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Add node"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "code",
                      "text": "E"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Add edge"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "code",
                      "text": "H"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Pan (drag the canvas)"
                    }
                  ]
                ],
                [
                  [
                    {
                      "kind": "code",
                      "text": "F"
                    }
                  ],
                  [
                    {
                      "kind": "text",
                      "text": "Fit the whole network on screen"
                    }
                  ]
                ]
              ]
            }
          ]
        }
      ]
    }
  ]
};
