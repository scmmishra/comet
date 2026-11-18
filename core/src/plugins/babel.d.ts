// Babel ships no types. Comet calls only these, to compile a plugin's JSX.
declare module "@babel/core" {
  export function transformAsync(code: string, options: Record<string, unknown>): Promise<{ code?: string | null } | null>
}
declare module "babel-preset-solid" {
  const preset: unknown
  export default preset
}
