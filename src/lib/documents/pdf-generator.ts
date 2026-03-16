import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

export interface PlantaoData {
    numero: number;
    dia: string;
    horario: string;
    turno: string;
    cuidador: string;
    valorCuidador: number;
    taxaMA: number;
    total: number;
}

export interface CenarioData {
    nome: string;
    totalSemanal: number;
    estimativaMensal: number;
    plantoes: PlantaoData[];
    parametros: {
        r0: number;
        a2p: number;
        an: number;
        afds: number;
        metodoPagamento: string;
        periodo: string;
    };
    descontos: Array<{ periodo: string; percentual: number }>;
    coberturaInicio?: string;
    coberturaFim?: string;
}

export interface PlanejamentoData {
    dataInicioCuidado?: string;
    dataFimCuidado?: string;
    diasAtendimento?: string[];
    periodicidade?: string;
    semanasPlanejadas?: number;
    mesesPlanejados?: number;
    horasCuidadoDia?: number;
    tempoCuidadoDescricao?: string;
    alocacaoResumo?: string;
    presetCobertura?: string;
}

export interface AvaliacaoSectionData {
    titulo: string;
    linhas: string[];
}

export interface ConfiguracaoComercialData {
    valorPeriodo: number;
    dataVencimento: string;
    descontoPercentual: number;
    descontoValor: number;
    acrescimosValor: number;
    metodosPagamento: string[];
    opcoesParcelamento: string[];
    entrada: number;
    parcelas: number;
    valorParcela: number;
    valorLiquido: number;
}

export interface OrcamentoPDFData {
    referencia: string;
    dataEmissao: string;
    validadeDias: number;
    pacienteNome: string;
    numeroPacientes: number;
    condicaoClinica: string;
    profissionalMinimo: string;
    cenario: CenarioData;
    planejamento?: PlanejamentoData;
    avaliacaoSecoes?: AvaliacaoSectionData[];
    configuracaoComercial: ConfiguracaoComercialData;
    tipo: 'PROPOSTA' | 'CONTRATO';
    presetCoberturaLabel?: string;
}

const BRAND = '#00B0B9';
const PDF_FONT_REGULAR_NAME = 'Lato';
const PDF_FONT_BOLD_NAME = 'LatoBold';
const PDF_FONT_REGULAR_PATH = path.join(process.cwd(), 'src/assets/fonts/Lato-Regular.ttf');
const PDF_FONT_BOLD_PATH = path.join(process.cwd(), 'src/assets/fonts/Lato-Bold.ttf');

function assertPdfFontAvailable(fontPath: string) {
    if (!fs.existsSync(fontPath)) {
        throw new Error(`Fonte PDF nao encontrada: ${fontPath}`);
    }
}

function brl(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function sanitizeCaregiverLabel(value: string, fallbackNumber: number): string {
    const raw = String(value || '').toUpperCase().trim();
    const match = raw.match(/\d+/);
    if (match) return `C${match[0]}`;
    return `C${fallbackNumber}`;
}

function escapePdfText(value: string) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
}

function buildPdfFromLines(lines: string[]): Buffer {
    const pageHeight = 842;
    const marginLeft = 50;
    const startY = 790;
    const lineHeight = 14;

    let cursorY = startY;
    const commands: string[] = ['BT', '/F1 11 Tf'];

    for (const line of lines) {
        if (cursorY < 60) break;
        commands.push(`${marginLeft} ${cursorY} Td (${escapePdfText(line)}) Tj`);
        cursorY -= lineHeight;
    }

    commands.push('ET');
    const streamContent = commands.join('\n');

    const objects = [
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj',
        `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj`,
        `4 0 obj << /Length ${Buffer.byteLength(streamContent, 'utf8')} >> stream\n${streamContent}\nendstream endobj`,
        '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    ];

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];

    for (const obj of objects) {
        offsets.push(Buffer.byteLength(pdf, 'utf8'));
        pdf += `${obj}\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';

    for (let i = 1; i < offsets.length; i += 1) {
        pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }

    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'utf8');
}

export async function generateOrcamentoPDF(data: OrcamentoPDFData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        assertPdfFontAvailable(PDF_FONT_REGULAR_PATH);
        assertPdfFontAvailable(PDF_FONT_BOLD_PATH);

        const doc = new PDFDocument({
            size: 'A4',
            margin: 50,
            bufferPages: true,
            font: PDF_FONT_REGULAR_PATH,
        });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.registerFont(PDF_FONT_REGULAR_NAME, PDF_FONT_REGULAR_PATH);
        doc.registerFont(PDF_FONT_BOLD_NAME, PDF_FONT_BOLD_PATH);
        doc.font(PDF_FONT_REGULAR_NAME);

        const width = doc.page.width - 100;
        let y = 50;

        const logoPath = path.join(process.cwd(), 'src/assets/logo.png');
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 50, y, { height: 40 });
        } else {
            doc.fontSize(18).fillColor(BRAND).font(PDF_FONT_BOLD_NAME).text('MAOS AMIGAS', 50, y);
            doc.fontSize(9).fillColor('#555').font(PDF_FONT_REGULAR_NAME).text('Cuidadores de Idosos - Toledo PR', 50, y + 22);
        }

        const titulo = data.tipo === 'PROPOSTA' ? 'PROPOSTA COMERCIAL' : 'CONTRATO DE PRESTACAO DE SERVICOS';
        doc.fontSize(12).fillColor('#111').font(PDF_FONT_BOLD_NAME).text(titulo, 250, y, { align: 'right', width: width - 200 });

        doc.fontSize(8).fillColor('#666').font(PDF_FONT_REGULAR_NAME)
            .text(`Ref. ${data.referencia}  |  Emissao: ${data.dataEmissao}`, 250, y + 16, { align: 'right', width: width - 200 })
            .text('Contato: (45) 9 8825-0695', 250, y + 28, { align: 'right', width: width - 200 })
            .text('contato@maosamigas.com', 250, y + 38, { align: 'right', width: width - 200 })
            .text('Toledo - PR', 250, y + 48, { align: 'right', width: width - 200 });

        y += 70;
        doc.moveTo(50, y).lineTo(50 + width, y).strokeColor(BRAND).lineWidth(1.5).stroke();
        y += 15;

        doc.fontSize(11).fillColor(BRAND).font(PDF_FONT_BOLD_NAME).text('01  PERFIL DO ATENDIMENTO', 50, y);
        y += 18;

        const perfil: [string, string][] = [
            ['Pacientes:', `${data.numeroPacientes} idoso(s)`],
            ['Complexidade:', data.condicaoClinica],
            ['Profissional:', data.profissionalMinimo],
            ['Cobertura:', `${data.cenario.coberturaInicio ?? 'Dom 19h'} -> ${data.cenario.coberturaFim ?? 'Sab 07h'}`],
        ];
        if (data.presetCoberturaLabel) {
            perfil.push(['Tipo de cobertura:', data.presetCoberturaLabel]);
        }

        doc.fontSize(9).fillColor('#333');
        const labelColWidth = 110;
        for (const [label, value] of perfil) {
            if (y > doc.page.height - 60) {
                doc.addPage();
                y = 50;
            }
            doc.font(PDF_FONT_BOLD_NAME).text(label, 50, y, { width: labelColWidth });
            const labelY = doc.y;
            doc.font(PDF_FONT_REGULAR_NAME).text(String(value), 50 + labelColWidth, y, { width: width - labelColWidth });
            y = Math.max(labelY, doc.y) + 4;
        }

        if (data.planejamento) {
            const planejamentoLinhas: Array<[string, string]> = [];
            if (data.planejamento.dataInicioCuidado || data.planejamento.dataFimCuidado) {
                planejamentoLinhas.push([
                    'Periodo:',
                    `${data.planejamento.dataInicioCuidado || '-'} -> ${data.planejamento.dataFimCuidado || '-'}`,
                ]);
            }
            if (data.planejamento.periodicidade) {
                planejamentoLinhas.push(['Periodicidade:', data.planejamento.periodicidade]);
            }
            if (data.planejamento.semanasPlanejadas !== undefined || data.planejamento.mesesPlanejados !== undefined) {
                planejamentoLinhas.push([
                    'Horizonte:',
                    `${data.planejamento.semanasPlanejadas ?? '-'} semana(s) / ${data.planejamento.mesesPlanejados ?? '-'} mes(es)`,
                ]);
            }
            if (data.planejamento.horasCuidadoDia !== undefined) {
                planejamentoLinhas.push(['Carga diaria:', `${data.planejamento.horasCuidadoDia}h/dia`]);
            }
            if (data.planejamento.diasAtendimento?.length) {
                planejamentoLinhas.push(['Dias:', data.planejamento.diasAtendimento.join(', ')]);
            }
            if (data.planejamento.tempoCuidadoDescricao) {
                planejamentoLinhas.push(['Tempo:', data.planejamento.tempoCuidadoDescricao]);
            }
            if (data.planejamento.alocacaoResumo) {
                planejamentoLinhas.push(['Alocacao:', data.planejamento.alocacaoResumo]);
            }

            if (planejamentoLinhas.length > 0) {
                y += 6;
                if (y > doc.page.height - 80) {
                    doc.addPage();
                    y = 50;
                }
                doc.fontSize(10).fillColor(BRAND).font(PDF_FONT_BOLD_NAME).text('Planejamento 360', 50, y);
                y = doc.y + 6;
                doc.fontSize(8).fillColor('#333');

                for (const [label, value] of planejamentoLinhas) {
                    if (y > doc.page.height - 60) {
                        doc.addPage();
                        y = 50;
                    }
                    doc.font(PDF_FONT_BOLD_NAME).text(label, 50, y, { width: labelColWidth });
                    const labelY = doc.y;
                    doc.font(PDF_FONT_REGULAR_NAME).text(String(value), 50 + labelColWidth, y, { width: width - labelColWidth });
                    y = Math.max(labelY, doc.y) + 4;
                }
            }
        }

        if (Array.isArray(data.avaliacaoSecoes) && data.avaliacaoSecoes.length > 0) {
            if (y > 640) {
                doc.addPage();
                y = 50;
            }

            y += 6;
            doc.fontSize(11).fillColor(BRAND).font(PDF_FONT_BOLD_NAME).text('Avaliacao Completa', 50, y);
            y += 16;

            for (const secao of data.avaliacaoSecoes) {
                if (!secao?.linhas?.length) continue;
                if (y > 700) {
                    doc.addPage();
                    y = 50;
                }

                doc.fontSize(9).fillColor('#1f2937').font(PDF_FONT_BOLD_NAME).text(secao.titulo, 50, y);
                y += 12;

                doc.fontSize(8).fillColor('#374151').font(PDF_FONT_REGULAR_NAME);
                for (const linha of secao.linhas) {
                    const rendered = `- ${linha}`;
                    const lineHeight = doc.heightOfString(rendered, { width }) + 2;
                    if (y + lineHeight > doc.page.height - 60) {
                        doc.addPage();
                        y = 50;
                        doc.fontSize(8).fillColor('#374151').font(PDF_FONT_REGULAR_NAME);
                    }
                    doc.text(rendered, 50, y, { width });
                    y += lineHeight;
                }
                y += 6;
            }
        }
        y += 8;

        doc.fontSize(11).fillColor(BRAND).font(PDF_FONT_BOLD_NAME).text('02  ESCALA SEMANAL DE PLANTOES', 50, y);
        y += 16;

        const columns = [20, 58, 82, 92, 54, 72, 72, 72];
        const headers = ['#', 'Dia', 'Horario', 'Turno', 'Cuid.', 'Val. Cuid.', 'Taxa MA', 'Total'];
        doc.rect(50, y, width, 16).fill('#E8F9FA');

        let x = 50;
        doc.fontSize(8).fillColor('#333').font(PDF_FONT_BOLD_NAME);
        for (let i = 0; i < headers.length; i += 1) {
            doc.text(headers[i], x + 2, y + 4, { width: columns[i], align: i >= 5 ? 'right' : 'left' });
            x += columns[i];
        }
        y += 16;

        let totalCuidador = 0;
        let totalTaxa = 0;
        let totalGeral = 0;

        doc.font(PDF_FONT_REGULAR_NAME).fontSize(8).fillColor('#222');
        data.cenario.plantoes.forEach((plantao, index) => {
            if (y > 730) {
                doc.addPage();
                y = 50;
            }
            x = 50;
            doc.rect(50, y, width, 14).fill(plantao.numero % 2 === 0 ? '#FAFAFA' : '#FFFFFF');
            doc.fillColor('#222');

            const cells = [
                String(plantao.numero),
                plantao.dia,
                plantao.horario,
                plantao.turno,
                sanitizeCaregiverLabel(plantao.cuidador, (index % 6) + 1),
                brl(plantao.valorCuidador),
                brl(plantao.taxaMA),
                brl(plantao.total),
            ];

            for (let i = 0; i < cells.length; i += 1) {
                doc.text(cells[i], x + 2, y + 3, { width: columns[i], align: i >= 5 ? 'right' : 'left' });
                x += columns[i];
            }

            totalCuidador += plantao.valorCuidador;
            totalTaxa += plantao.taxaMA;
            totalGeral += plantao.total;
            y += 14;
        });

        doc.rect(50, y, width, 15).fill(BRAND);
        x = 50;
        const totals = ['SEMANAL', '', '', '', '', brl(totalCuidador), brl(totalTaxa), brl(totalGeral)];
        doc.fillColor('#FFFFFF').font(PDF_FONT_BOLD_NAME).fontSize(8);
        for (let i = 0; i < totals.length; i += 1) {
            doc.text(totals[i], x + 2, y + 4, { width: columns[i], align: i >= 5 ? 'right' : 'left' });
            x += columns[i];
        }
        y += 22;

        if (y > 680) {
            doc.addPage();
            y = 50;
        }

        doc.fontSize(11).fillColor(BRAND).font(PDF_FONT_BOLD_NAME).text('03  RESUMO FINANCEIRO', 50, y);
        y += 16;
        doc.fontSize(9).fillColor('#333');
        doc.font(PDF_FONT_BOLD_NAME).text('Total Semanal: ', 50, y, { continued: true });
        doc.font(PDF_FONT_REGULAR_NAME).text(brl(data.cenario.totalSemanal));
        y += 14;
        doc.font(PDF_FONT_BOLD_NAME).text('Estimativa Mensal (x4,33): ', 50, y, { continued: true });
        doc.font(PDF_FONT_REGULAR_NAME).text(brl(data.cenario.estimativaMensal));
        y += 18;

        const comercial = data.configuracaoComercial;
        doc.fontSize(10).fillColor(BRAND).font(PDF_FONT_BOLD_NAME).text('Configuracao Comercial', 50, y);
        y = doc.y + 8;
        const comercialLinhas: Array<[string, string]> = [
            ['Valor do periodo:', brl(comercial.valorPeriodo)],
            ['Data vencimento:', comercial.dataVencimento],
            ['Desconto (%):', `${comercial.descontoPercentual.toFixed(2)}%`],
            ['Descontos (R$):', brl(comercial.descontoValor)],
            ['Acrescimos (R$):', brl(comercial.acrescimosValor)],
            ['Metodos de pagamento:', comercial.metodosPagamento.join(', ')],
            ['Forma de pagamento:', comercial.opcoesParcelamento.join(', ')],
            ['Entrada:', brl(comercial.entrada)],
            ['Parcelamento:', `${comercial.parcelas}x de ${brl(comercial.valorParcela)}`],
            ['Valor final:', brl(comercial.valorLiquido)],
        ];

        doc.fontSize(8).fillColor('#333');
        const comercialLabelWidth = 140;
        for (const [label, value] of comercialLinhas) {
            if (y > doc.page.height - 60) {
                doc.addPage();
                y = 50;
                doc.fontSize(8).fillColor('#333');
            }
            doc.font(PDF_FONT_BOLD_NAME).text(label, 50, y, { width: comercialLabelWidth });
            const labelY = doc.y;
            doc.font(PDF_FONT_REGULAR_NAME).text(String(value), 50 + comercialLabelWidth, y, { width: width - comercialLabelWidth });
            y = Math.max(labelY, doc.y) + 4;
        }
        y += 8;

        doc.rect(50, y, 320, 14).fill('#E8F9FA');
        doc.fillColor('#333').font(PDF_FONT_BOLD_NAME).fontSize(8)
            .text('Periodo', 53, y + 3, { width: 100 })
            .text('Desconto', 153, y + 3, { width: 80 })
            .text('Economia/mes', 233, y + 3, { width: 140 });
        y += 14;

        for (let i = 0; i < data.cenario.descontos.length; i += 1) {
            const desconto = data.cenario.descontos[i];
            doc.rect(50, y, 320, 13).fill(i % 2 === 0 ? '#FFFFFF' : '#FAFAFA');
            doc.fillColor('#222').font(PDF_FONT_REGULAR_NAME).fontSize(8)
                .text(desconto.periodo, 53, y + 3, { width: 100 })
                .text(`${desconto.percentual}%`, 153, y + 3, { width: 80 })
                .text(brl(data.cenario.estimativaMensal * desconto.percentual / 100), 233, y + 3, { width: 140 });
            y += 13;
        }
        y += 12;

        if (y > 650) {
            doc.addPage();
            y = 50;
        }

        doc.fontSize(11).fillColor(BRAND).font(PDF_FONT_BOLD_NAME).text('04  COMPOSICAO DO PRECO POR PLANTAO', 50, y);
        y += 16;

        const { r0, a2p, an, afds } = data.cenario.parametros;
        const valorDiurno = r0 * (1 + a2p / 100);
        const valorNoturno = valorDiurno * (1 + an / 100);
        const valorFds = valorNoturno * (1 + afds / 100);

        const compositionColumns = [180, 90, 90, 90];
        const compositionHeaders = ['Componente', 'Diurno', 'Noturno', 'Not.+FDS'];

        doc.rect(50, y, 450, 14).fill('#E8F9FA');
        x = 50;
        doc.fillColor('#333').font(PDF_FONT_BOLD_NAME).fontSize(8);
        for (let i = 0; i < compositionHeaders.length; i += 1) {
            doc.text(compositionHeaders[i], x + 2, y + 3, { width: compositionColumns[i], align: i > 0 ? 'right' : 'left' });
            x += compositionColumns[i];
        }
        y += 14;

        const compositionRows = [
            [`Base cuidador (R0 = ${brl(r0)})`, brl(r0), brl(r0), brl(r0)],
            [`+ 2 paciente (${a2p}%)`, brl(r0 * a2p / 100), brl(r0 * a2p / 100), brl(r0 * a2p / 100)],
            [`+ Noturno (${an}%)`, '-', brl(valorDiurno * an / 100), brl(valorDiurno * an / 100)],
            [`+ FDS (${afds}%)`, '-', '-', brl(valorNoturno * afds / 100)],
        ];

        doc.font(PDF_FONT_REGULAR_NAME).fontSize(8).fillColor('#222');
        for (let row = 0; row < compositionRows.length; row += 1) {
            doc.rect(50, y, 450, 13).fill(row % 2 === 0 ? '#FFFFFF' : '#FAFAFA');
            x = 50;
            for (let col = 0; col < compositionRows[row].length; col += 1) {
                doc.text(compositionRows[row][col], x + 2, y + 3, { width: compositionColumns[col], align: col > 0 ? 'right' : 'left' });
                x += compositionColumns[col];
            }
            y += 13;
        }

        doc.rect(50, y, 450, 14).fill(BRAND);
        x = 50;
        const compositionTotals = ['= Preco Final ao Cliente', brl(valorDiurno), brl(valorNoturno), brl(valorFds)];
        doc.fillColor('#FFFFFF').font(PDF_FONT_BOLD_NAME).fontSize(8);
        for (let i = 0; i < compositionTotals.length; i += 1) {
            doc.text(compositionTotals[i], x + 2, y + 3, { width: compositionColumns[i], align: i > 0 ? 'right' : 'left' });
            x += compositionColumns[i];
        }
        y += 22;

        if (data.tipo === 'CONTRATO') {
            if (y > 640) {
                doc.addPage();
                y = 50;
            }

            doc.fontSize(11).fillColor(BRAND).font(PDF_FONT_BOLD_NAME).text('05  CONDICOES GERAIS', 50, y);
            y += 14;
            const condicoes = [
                `Pagamento: ${comercial.metodosPagamento.join(', ')}.`,
                `Parcelamento disponivel: ${comercial.opcoesParcelamento.join(', ')}.`,
                'Substituicao: profissional substituto acionado sem custo adicional em caso de falta.',
                'Cancelamento: conforme politica do contrato. Menos de 24h pode incorrer em taxa.',
                'Falecimento: em caso de obito do paciente, o contrato sera automaticamente cancelado mediante apresentacao da Certidao de Obito pela familia ou responsavel legal. O ultimo dia de cobranca sera o ultimo dia em que houve plantao efetivo, incluindo o dia do falecimento caso o profissional ja estivesse em atendimento. Valores pagos antecipadamente referentes a periodo posterior ao ultimo plantao serao devolvidos proporcionalmente em ate 15 (quinze) dias uteis, via PIX, transferencia bancaria ou dinheiro em especie, conforme preferencia da familia.',
                'Reajuste: valores revisados trimestralmente ou conforme alteracao de escopo.',
                'LGPD: dados do paciente tratados conforme Lei 13.709/2018.',
                `Validade: ${data.validadeDias} dias a partir de ${data.dataEmissao}.`,
            ];

            doc.fontSize(8).fillColor('#333').font(PDF_FONT_REGULAR_NAME);
            for (const condicao of condicoes) {
                doc.text(`- ${condicao}`, 50, y, { width });
                y += doc.heightOfString(`- ${condicao}`, { width }) + 4;
            }
        }

        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
            doc.switchToPage(i);
            const pageBottom = doc.page.height - 40;
            doc.moveTo(50, pageBottom - 15).lineTo(50 + width, pageBottom - 15).strokeColor('#E5E7EB').lineWidth(1).stroke();
            doc.fontSize(8).fillColor('#6B7280').font(PDF_FONT_REGULAR_NAME)
                .text('✓ Empresa Registrada - CNPJ: 52.724.250/0001-78   |   Maos Amigas', 50, pageBottom - 8, { continued: true, width, align: 'center' })
                .text(`   |   Pag. ${i + 1} de ${pages.count}`);
        }

        doc.flushPages();
        doc.end();
    });
}

export function generatePropostaPDF(data: OrcamentoPDFData): Promise<Buffer> {
    return generateOrcamentoPDF({ ...data, tipo: 'PROPOSTA' });
}

export function generateContratoPDF(data: OrcamentoPDFData): Promise<Buffer> {
    return generateOrcamentoPDF({ ...data, tipo: 'CONTRATO' });
}

export async function generateContractTextPDF(title: string, content: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        assertPdfFontAvailable(PDF_FONT_REGULAR_PATH);
        assertPdfFontAvailable(PDF_FONT_BOLD_PATH);

        const doc = new PDFDocument({
            size: 'A4',
            margin: 50,
            bufferPages: true,
            font: PDF_FONT_REGULAR_PATH,
        });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.registerFont(PDF_FONT_REGULAR_NAME, PDF_FONT_REGULAR_PATH);
        doc.registerFont(PDF_FONT_BOLD_NAME, PDF_FONT_BOLD_PATH);

        const width = doc.page.width - 100;
        let y = 50;

        const logoPath = path.join(process.cwd(), 'src/assets/logo.png');
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 50, y, { height: 40 });
        } else {
            doc.fontSize(18).fillColor(BRAND).font(PDF_FONT_BOLD_NAME).text('MAOS AMIGAS', 50, y);
        }

        doc.fontSize(12).fillColor('#111').font(PDF_FONT_BOLD_NAME).text(title, 250, y, { align: 'right', width: width - 200 });

        doc.fontSize(8).fillColor('#666').font(PDF_FONT_REGULAR_NAME)
            .text('Contato: (45) 9 8825-0695', 250, y + 16, { align: 'right', width: width - 200 })
            .text('contato@maosamigas.com', 250, y + 26, { align: 'right', width: width - 200 })
            .text('Toledo - PR', 250, y + 36, { align: 'right', width: width - 200 });

        y += 65;
        doc.moveTo(50, y).lineTo(50 + width, y).strokeColor(BRAND).lineWidth(1.5).stroke();

        doc.y = y + 15;
        doc.font(PDF_FONT_REGULAR_NAME).fontSize(9).fillColor('#111');

        const lines = String(content || '').split(/\r?\n/);
        for (const line of lines) {
            if (doc.y > doc.page.height - 70) {
                doc.addPage();
                doc.font(PDF_FONT_REGULAR_NAME).fontSize(9).fillColor('#111');
            }
            doc.text(line || ' ', {
                width: doc.page.width - 100,
                align: 'left',
            });
        }

        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
            doc.switchToPage(i);
            const pageBottom = doc.page.height - 40;
            doc.moveTo(50, pageBottom - 15).lineTo(50 + width, pageBottom - 15).strokeColor('#E5E7EB').lineWidth(1).stroke();
            doc.fontSize(8).fillColor('#6B7280').font(PDF_FONT_REGULAR_NAME)
                .text('✓ Empresa Registrada - CNPJ: 52.724.250/0001-78   |   Maos Amigas', 50, pageBottom - 8, { continued: true, width, align: 'center' })
                .text(`   |   Pag. ${i + 1} de ${pages.count}`);
        }

        doc.flushPages();
        doc.end();
    });
}

export function gerarPropostaPDF(lines: string[]): Buffer {
    return buildPdfFromLines(lines);
}

export function gerarContratoPDF(lines: string[]): Buffer {
    return buildPdfFromLines(lines);
}

