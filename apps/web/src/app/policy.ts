/**
 * The page's Content-Security-Policy refuses `eval`, wherever it is deployed.
 * zod compiles its object parsers with `new Function` when it can, and finds
 * out whether it can by trying, which the policy reports as a violation
 * (and refuses, so nothing is lost by not trying). It is told not to.
 *
 * Imported for its effect, before anything is parsed.
 */
import { z } from 'zod';

z.config({ jitless: true });
