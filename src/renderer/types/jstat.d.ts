declare module 'jstat' {
  interface Distribution {
    cdf(value: number, degreesOfFreedom: number, denominatorDegreesOfFreedom?: number): number;
    inv(probability: number, degreesOfFreedom: number): number;
  }

  export const jStat: {
    studentt: Distribution;
    centralF: Distribution;
    chisquare: Distribution;
    normal: {
      cdf(value: number, mean: number, standardDeviation: number): number;
      inv(probability: number, mean: number, standardDeviation: number): number;
    };
  };
}
