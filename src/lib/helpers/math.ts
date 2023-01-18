export const decimalRoundTo = (value: number, decimalPlaces: number) => {
  const processDecimalPlaces = Math.pow(10, decimalPlaces);

  return Math.round((value + Number.EPSILON) * processDecimalPlaces) / processDecimalPlaces;
};
