import {writeFileSync} from 'node:fs';
import {referenceCases,generateReference} from './references';
for(let i=0;i<referenceCases.length;i++)writeFileSync(`reports/fidelity-v4/e2-2/${referenceCases[i]!.name}-evidence.json`,JSON.stringify(generateReference(i))+'\n');
