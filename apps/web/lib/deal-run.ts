import { acquisitions, wholesale, buyAndHold, rehabEstimator, sensitivityGrid, scaled, ENGINE_VERSION, type DealInput, type AcquisitionsInput } from "@dealcalc/engine";

export type DealOutputs = {
  acquisitions: ReturnType<typeof acquisitions>;
  wholesale: ReturnType<typeof wholesale>;
  rehab: ReturnType<typeof rehabEstimator>;
  buyAndHold: ReturnType<typeof buyAndHold> | null;
  sensitivity: ReturnType<typeof sensitivityGrid> | null;
  engineVersion: string;
};

/** Run every calculator for one DealInput. Pure; safe on the server and in the browser. */
export function runDeal(inputs: DealInput, opts: { sensitivity?: boolean } = {}): DealOutputs {
  const rehab = rehabEstimator(inputs.rehab);
  const acqInput: AcquisitionsInput = { ...inputs.acquisitions, rehab: inputs.rehab, repairCostsOverride: inputs.acquisitions.repairCostsOverride ?? null } as AcquisitionsInput;
  const acq = acquisitions(acqInput);
  const ws = wholesale({
    arv: inputs.acquisitions.arv, repairCosts: acq.repairCosts, assignmentFee: inputs.wholesale?.assignmentFee ?? Math.abs(inputs.acquisitions.assignmentFee),
    purchasePrice: inputs.acquisitions.purchasePrice, investorBuyPrice: inputs.wholesale?.investorBuyPrice ?? null,
    closingCosts: inputs.wholesale?.closingCosts ?? 0, holdingCosts: inputs.wholesale?.holdingCosts ?? 0,
    existingMortgagePayoff: inputs.wholesale?.existingMortgagePayoff ?? 0, sellerClosingCosts: inputs.wholesale?.sellerClosingCosts ?? 0, arvFactor: inputs.acquisitions.arvFactor,
  });
  const bh = inputs.buyAndHold ? buyAndHold(inputs.buyAndHold) : null;
  const sens = opts.sensitivity
    ? sensitivityGrid(acqInput, { key: "arv", values: scaled(inputs.acquisitions.arv, [0.9, 0.95, 1, 1.05, 1.1]) }, { key: "repairCosts", values: scaled(Math.max(acq.repairCosts, 1000), [0.8, 0.9, 1, 1.1, 1.25]) })
    : null;
  return { acquisitions: acq, wholesale: ws, rehab, buyAndHold: bh, sensitivity: sens, engineVersion: ENGINE_VERSION };
}
