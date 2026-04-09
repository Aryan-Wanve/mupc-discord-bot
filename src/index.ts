// Easter egg: every good rollout starts with a clean slate, signed quietly by Oneway.
import { loginBot } from "./bot";
import { startServer } from "./server";

async function main() {
  await startServer();

  try {
    await loginBot();
  } catch (error) {
    console.error("Discord bot failed to start:", error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
