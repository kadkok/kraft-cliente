// Decisões reais do JEV; regenerar apenas com tools/jev-phenomena.mjs. Sem rede em runtime.
export const JEV_POLICY = {
  "version": 1,
  "model": "jev-1.14.0",
  "requestHash": "6b154c43f58320257b333a2fff5c2a3b42bcca309866d51f7f4678f1ab163aaf",
  "weights": {
    "stone": [
      {
        "variant": "chunk",
        "weight": 0.3425
      },
      {
        "variant": "fracture",
        "weight": 0.43600000000000005
      },
      {
        "variant": "collapse",
        "weight": 0.2215
      }
    ],
    "earth": [
      {
        "variant": "crumble",
        "weight": 0.5405
      },
      {
        "variant": "compact",
        "weight": 0.1995
      },
      {
        "variant": "slump",
        "weight": 0.26
      }
    ],
    "wood": [
      {
        "variant": "split",
        "weight": 0.41400000000000003
      },
      {
        "variant": "splinter",
        "weight": 0.41400000000000003
      },
      {
        "variant": "snap",
        "weight": 0.172
      }
    ],
    "glass": [
      {
        "variant": "shatter",
        "weight": 0.271
      },
      {
        "variant": "crack",
        "weight": 0.348
      },
      {
        "variant": "chips",
        "weight": 0.381
      }
    ],
    "calm": [
      {
        "variant": "drift",
        "weight": 0.491
      },
      {
        "variant": "flutter",
        "weight": 0.23249999999999998
      },
      {
        "variant": "tumble",
        "weight": 0.2765
      }
    ],
    "breeze": [
      {
        "variant": "drift",
        "weight": 0.2545
      },
      {
        "variant": "flutter",
        "weight": 0.546
      },
      {
        "variant": "tumble",
        "weight": 0.1995
      }
    ],
    "gust": [
      {
        "variant": "drift",
        "weight": 0.16649999999999998
      },
      {
        "variant": "flutter",
        "weight": 0.238
      },
      {
        "variant": "tumble",
        "weight": 0.5955
      }
    ]
  }
};
