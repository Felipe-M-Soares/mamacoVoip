/*!
 * Origem: @sapphi-red/web-noise-suppressor@0.4.0 — dist/noiseGate/workletProcessor.js
 * https://github.com/sapphi-red/web-noise-suppressor
 *
 * MIT License
 *
 * Copyright (c) 2022 翠 / green
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
// Cópia literal de @sapphi-red/web-noise-suppressor@0.4.0's
// dist/noiseGate/workletProcessor.js — NÃO editar à mão.
//
// Por quê essa cópia existe: o pacote original tem DOIS arquivos com o
// MESMO nome "workletProcessor.js" (um em dist/rnnoise/, outro em
// dist/noiseGate/). O Vite, ao processar os dois como "?url" (pra pegar
// a URL final do arquivo depois do build), estava tratando os dois como
// se fossem o MESMO asset por causa do nome igual — o build só gerava
// UM arquivo de saída, e o worklet do noise gate (sensibilidade do
// microfone) acabava recebendo por engano o código do RNNoise, o que
// quebrava (erro "node name not defined") na hora de ativar o gate.
// Copiando esse arquivo aqui, com um nome ÚNICO, o Vite passa a tratar
// os dois como assets diferentes de verdade.
//
// Se atualizar a versão do @sapphi-red/web-noise-suppressor no
// package.json, reveja se esse arquivo (dist/noiseGate/workletProcessor.js
// dentro do pacote) mudou e copie o conteúdo novo aqui.
const e=e=>{let t=0;for(let n of e)t+=n*n;return Math.sqrt(t/e.length)},t=e=>10**(e/20),n={CLOSED:0,OPEN:1,CLOSING:2},r=({openThreshold:e,closeThreshold:r,holdMs:i,bufferMs:a})=>{let o=t(e),s=t(r),c=Math.ceil(i/a),l=n.CLOSED,u=0;return{next:e=>{switch(l){case n.CLOSED:e>o&&(l=n.OPEN);break;case n.OPEN:e<s&&(l=n.CLOSING,u=0);break;case n.CLOSING:e>s?l=n.OPEN:u>c?l=n.CLOSED:u++;break;default:console.error(`Unknown state: ${l}`)}},isOpen:()=>l===n.OPEN||l===n.CLOSING}},i=({openThreshold:t,closeThreshold:n,holdMs:i,maxChannels:a},o)=>{let s=r({openThreshold:t,closeThreshold:n,holdMs:i,bufferMs:o});return{process:(t,n)=>{let r=Math.min(t.length,a),i=0;for(let n=0;n<r;n++)i+=e(t[n])/r;if(s.next(i),s.isOpen())for(let e=0;e<r;e++)n[e].set(t[e])}}};var a=class extends AudioWorkletProcessor{constructor(e){super();let t=1e3/sampleRate*128;this.processor=i(e.processorOptions,t)}process(e,t,n){return e.length===0||!e[0]||e[0]?.length===0||this.processor.process(e[0],t[0]),!0}};registerProcessor(`@sapphi-red/web-noise-suppressor/noise-gate`,a);
