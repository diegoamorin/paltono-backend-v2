/** Runs a console command, printing its result or its error and setting the exit code. */
export function runCommand(command: () => Promise<string>): void {
  command().then(
    (message) => console.log(message),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
