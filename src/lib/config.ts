export function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
}

export function positiveInteger(name: string) {
  const value = Number(env(name));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Valor inválido de ${name}.`);
  return value;
}
