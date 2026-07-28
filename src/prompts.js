import { createInterface } from "node:readline/promises";

export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  const readline = createInterface({ input, output });

  return {
    async text(message, defaultValue = "") {
      const suffix = defaultValue ? ` (${defaultValue})` : "";
      const answer = (await readline.question(`${message}${suffix}: `)).trim();
      return answer || defaultValue;
    },

    async confirm(message, defaultValue = true) {
      const hint = defaultValue ? "Y/n" : "y/N";
      const answer = (await readline.question(`${message} [${hint}]: `)).trim().toLowerCase();
      if (!answer) return defaultValue;
      return answer === "y" || answer === "yes";
    },

    async select(message, choices, defaultIndex = 0) {
      output.write(`\n${message}\n`);
      choices.forEach((choice, index) => {
        output.write(`  ${index + 1}. ${choice}\n`);
      });

      while (true) {
        const answer = await readline.question(`Choose [${defaultIndex + 1}]: `);
        if (!answer.trim()) return choices[defaultIndex];

        const selectedIndex = Number.parseInt(answer, 10) - 1;
        if (selectedIndex >= 0 && selectedIndex < choices.length) {
          return choices[selectedIndex];
        }

        output.write(`Enter a number from 1 to ${choices.length}.\n`);
      }
    },

    close() {
      readline.close();
    },
  };
}
