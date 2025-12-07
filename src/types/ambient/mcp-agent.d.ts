// Ambient module declaration to satisfy TypeScript when the optional package
// @joshuacalpuerto/mcp-agent is not installed in the environment.
declare module '@joshuacalpuerto/mcp-agent' {
  const Agent: any;
  export default Agent;
  export { Agent };
}
