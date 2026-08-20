import readline from 'readline';
import { getOrCreateMasterPipeline } from './pipeline_manager.js';
import { runDistributeContacts } from './distribute_contacts.js';
import { runHistoricalAssignment } from './historical_assignment.js';
import { auditAdAttribution, runHistoricalAdAttributionSweep } from './ad_attribution_engine.js';
import { spawn } from 'child_process';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function startProcess(command, args) {
  const child = spawn(command, args, { stdio: 'inherit' });
  child.on('close', () => showMenu());
}

function showMenu() {
  console.log("\n=================================================");
  console.log("   SYSTEM CONTROL PANEL: GHL PIPELINE MAESTRO");
  console.log("=================================================");
  console.log("  1. [Create/Verify] Master Pipeline");
  console.log("  2. [Batch Run] Distribute Contacts (Precalificado vs Calificado)");
  console.log("  3. [Full Run] Verify + Distribute");
  console.log("  4. [Batch Run] Mudanza Histórica de Asignación (Palacios/Benavides)");
  console.log("  5. [Live Server] Start Webhook & Autopilot Engine");
  console.log("  6. [Ad Attribution] Peinado Histórico de Pauta & Deducciones");
  console.log("  7. [Auditoría] Verificar Construcción y Salud del Sistema");
  console.log("  8. [Exit]");
  console.log("=================================================");
  rl.question("Elige una opción (1-8): ", async (ans) => {
    switch (ans.trim()) {
      case '1':
        await getOrCreateMasterPipeline();
        showMenu();
        break;
      case '2':
        await runDistributeContacts();
        showMenu();
        break;
      case '3':
        await getOrCreateMasterPipeline();
        await runDistributeContacts();
        showMenu();
        break;
      case '4':
        await runHistoricalAssignment();
        showMenu();
        break;
      case '5':
        console.log("\n🚀 Iniciando el servidor híbrido...");
        startProcess('node', ['webhook_server.js']);
        break;
      case '6':
        await runHistoricalAdAttributionSweep();
        showMenu();
        break;
      case '7':
        startProcess('node', ['audit_system_health.js']);
        break;
      case '8':
        console.log("👋 Saliendo del Panel de Control.");
        process.exit(0);
      default:
        console.log("❌ Opción inválida. Intenta nuevamente.");
        rl.close();
        process.exit(0);
        break;
    }
  });
}

showMenu();
