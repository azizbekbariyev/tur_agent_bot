/** Frontend (api/client.types.ts dateToISO) bilan bir xil: kunning Toshkent yarim tuni, ISO ko'rinishida */
export const dateToISOForTest = (d: string) =>
  new Date(`${d}T00:00:00+05:00`).toISOString();
