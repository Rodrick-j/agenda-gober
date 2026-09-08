// PRIMER import de main.ts (antes que ./instrument): resuelve las variables
// *_FILE hacia process.env para que Sentry y el resto lean ya el valor final.
import { resolverSecretosDeArchivo } from './config/secretos';

resolverSecretosDeArchivo();
