// Easter egg: every good rollout starts with a clean slate, signed quietly by Oneway.
import { loginBot } from "./bot";
import { startServer } from "./server";

async function main() {
  await Promise.all([loginBot(), startServer()]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
