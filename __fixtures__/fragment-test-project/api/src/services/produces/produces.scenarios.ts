import type { Prisma, Produce } from "@prisma/client";

import type { ScenarioData } from "@cedarjs/testing/api";

export const standard = defineScenario<Prisma.ProduceCreateArgs>({
  produce: {
    one: {
      data: {
        name: "String2278482",
        quantity: 9057347,
        price: 7001521,
        region: "String",
        stall: { create: { name: "String", stallNumber: "String7691378" } },
      },
    },
    two: {
      data: {
        name: "String85307",
        quantity: 9698308,
        price: 4477131,
        region: "String",
        stall: { create: { name: "String", stallNumber: "String9433316" } },
      },
    },
  },
});

export type StandardScenario = ScenarioData<Produce, "produce">;
