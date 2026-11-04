import { writeFileSync } from 'node:fs';
import { renderReference, referenceCases } from './references';
for(let i=0;i<referenceCases.length;i++) writeFileSync(`reports/fidelity-v4/e2-visual/${referenceCases[i]!.name}-evidence.json`,JSON.stringify(renderReference(i))+'\n');
