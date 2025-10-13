// Inicializar el worker para pdf.js
// Las librerías (pdfjsLib, jspdf, JsBarcode) están disponibles globalmente gracias a los <script> en el HTML.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

// --- Referencias a Elementos del DOM ---
const paperSizeSelect = document.getElementById('paperSize');
const customPaperSizeDiv = document.getElementById('customPaperSize');
const pdfUploadInput = document.getElementById('pdfUpload');
const generateBtn = document.getElementById('generateBtn');
const loader = document.getElementById('loader');
const uploadStatus = document.getElementById('uploadStatus');

// Conjunto para almacenar series existentes y evitar duplicados
let existingSerials = new Set();

// --- Lógica de la Interfaz ---
paperSizeSelect.addEventListener('change', () => {
    customPaperSizeDiv.style.display = paperSizeSelect.value === 'custom' ? 'grid' : 'none';
});

// --- LÓGICA CORREGIDA PARA LEER PDFS CON SEMILLA ---
pdfUploadInput.addEventListener('change', async (event) => {
    const files = event.target.files;
    if (!files.length) return;

    loader.style.display = 'block';
    uploadStatus.textContent = `Cargando ${files.length} archivo(s)...`;

    existingSerials.clear();
    let loadedSerialsCount = 0;
    let seedsFound = 0;

    for (const file of files) {
        try {
            const fileReader = new FileReader();
            await new Promise((resolve, reject) => {
                fileReader.onload = resolve;
                fileReader.onerror = reject;
                fileReader.readAsArrayBuffer(file);
            });

            const typedarray = new Uint8Array(fileReader.result);
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            const metadata = await pdf.getMetadata();

            // Buscamos la semilla en el campo 'Keywords'
            if (metadata.info && metadata.info.Keywords) {
                const seed = metadata.info.Keywords;
                if (!isNaN(seed) && seed.trim() !== '') {
                    seedsFound++;
                    const configData = JSON.parse(metadata.info.Subject || '{}');
                    const quantity = configData.quantity || 0;
                    const barcodeType = configData.barcodeType;

                    if (quantity > 0 && barcodeType) {
                        const prng = mulberry32(parseInt(seed, 10)); // Inicializamos el generador con la semilla del archivo
                        for (let i = 0; i < quantity; i++) {
                            const serial = generateRandomSerial(barcodeType, prng);
                            existingSerials.add(serial);
                            loadedSerialsCount++;
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error procesando el archivo ${file.name}:`, error);
            alert(`Hubo un error al leer ${file.name}. Asegúrate que sea un PDF válido y no esté corrupto.`);
        }
    }

    uploadStatus.textContent = `Análisis de ${files.length} archivo(s) completo. ${seedsFound} semillas encontradas. Se cargaron ${loadedSerialsCount} series para evitar duplicados.`;
    loader.style.display = 'none';
});


// --- Lógica Principal de Generación de PDF ---
generateBtn.addEventListener('click', async () => {
    loader.style.display = 'block';
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        generatePdf();
    } catch (error) {
        console.error("Error al generar el PDF:", error);
        alert("Ocurrió un error inesperado al generar el PDF. Revisa la consola para más detalles.");
    } finally {
        loader.style.display = 'none';
    }
});

// --- Generador de Números Pseudo-Aleatorios (PRNG) basado en una semilla ---
function mulberry32(a) {
    return function() {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

function generatePdf() {
    const { jsPDF } = window.jspdf;

    const config = {
        paper: document.getElementById('paperSize').value,
        customW: parseFloat(document.getElementById('customWidth').value),
        customH: parseFloat(document.getElementById('customHeight').value),
        labelW: parseFloat(document.getElementById('labelWidth').value),
        labelH: parseFloat(document.getElementById('labelHeight').value),
        marginT: parseFloat(document.getElementById('marginTop').value),
        marginL: parseFloat(document.getElementById('marginLeft').value),
        hSpacing: parseFloat(document.getElementById('hSpacing').value),
        vSpacing: parseFloat(document.getElementById('vSpacing').value),
        barcodeType: document.getElementById('barcodeType').value,
        barcodeH: parseFloat(document.getElementById('barcodeHeight').value),
        fontSize: parseFloat(document.getElementById('fontSize').value),
        quantity: parseInt(document.getElementById('quantity').value, 10),
    };

    if (Object.values(config).some(v => isNaN(v) && typeof v !== 'string')) {
        alert("Por favor, rellena todos los campos numéricos correctamente.");
        return;
    }

    let paperFormat, paperWidth, paperHeight;
    if (config.paper === 'custom') {
        paperWidth = config.customW;
        paperHeight = config.customH;
        paperFormat = [paperWidth, paperHeight];
    } else {
        paperFormat = config.paper;
        const tempDoc = new jsPDF({ unit: 'mm', format: paperFormat });
        paperWidth = tempDoc.internal.pageSize.getWidth();
        paperHeight = tempDoc.internal.pageSize.getHeight();
    }

    if (config.labelW + config.marginL > paperWidth || config.labelH + config.marginT > paperHeight) {
        alert("Error de medidas: La etiqueta (incluyendo el margen) es más ancha o más alta que el papel.\n\nPor favor, ajusta las dimensiones.");
        return;
    }

    const doc = new jsPDF({ unit: 'mm', format: paperFormat });

    // --- LÓGICA DE SEMILLA CORREGIDA ---
    const seed = Date.now();
    const prng = mulberry32(seed); // Se crea y se GUARDA en la variable 'prng'

    let x = config.marginL;
    let y = config.marginT;
    const newlyGeneratedSerials = [];

    for (let i = 0; i < config.quantity; i++) {
        let newSerial;
        do {
            // Se PASA el generador 'prng' a la función
            newSerial = generateRandomSerial(config.barcodeType, prng);
        } while (existingSerials.has(newSerial));

        newlyGeneratedSerials.push(newSerial);
        existingSerials.add(newSerial);

        const canvas = document.createElement('canvas');
        try {
            JsBarcode(canvas, newSerial, {
                format: config.barcodeType,
                width: 2,
                height: config.barcodeH * 3.78,
                displayValue: true,
                text: newSerial,
                fontOptions: "bold",
                fontSize: config.fontSize * 2,
                margin: 10
            });
        } catch (error) {
            alert(`Error al generar el código de barras para el serial "${newSerial}".\nEl formato "${config.barcodeType}" podría no ser compatible con el dato.\n\nError: ${error.message}`);
            return;
        }

        const barcodeDataUrl = canvas.toDataURL('image/png');
        doc.addImage(barcodeDataUrl, 'PNG', x, y, config.labelW, config.labelH);

        if (i < config.quantity - 1) {
            x += config.labelW + config.hSpacing;
            if (x + config.labelW > paperWidth) {
                x = config.marginL;
                y += config.labelH + config.vSpacing;
                if (y + config.labelH > paperHeight) {
                    doc.addPage();
                    x = config.marginL;
                    y = config.marginT;
                }
            }
        }
    }

    if (newlyGeneratedSerials.length > 0) {
        doc.setDocumentProperties({
            title: 'Etiquetas de Códigos de Barras',
            subject: JSON.stringify({quantity: config.quantity, barcodeType: config.barcodeType}),
            author: 'GervaSoft E.I.R.L.',
            keywords: seed.toString(),
            creator: 'Generador de Etiquetas Web'
        });
    }

    doc.save(`etiquetas_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function calcularChecksum(data, isEan13) {
    let sum1 = 0;
    let sum2 = 0;

    const multiplier1 = isEan13 ? 1 : 3;
    const multiplier2 = isEan13 ? 3 : 1;

    for (let i = 0; i < data.length; i++) {
        if ((i + 1) % 2 !== 0) {
            sum1 += parseInt(data[i], 10);
        } else {
            sum2 += parseInt(data[i], 10);
        }
    }

    const totalSum = (sum1 * multiplier1) + (sum2 * multiplier2);
    // --- CORRECCIÓN FINAL DEL ERROR DE TIPEO ---
    const checksum = (10 - (totalSum % 10)) % 10;
    return checksum;
}


// --- FUNCIÓN DE AYUDA MODIFICADA para usar el generador predecible (prng) ---
function generateRandomSerial(format, prng) {
    // Si no se pasa un generador, usamos el aleatorio por defecto (Math.random)
    const random = prng || Math.random;
    const nums = '0123456789';
    const getRandomChar = (str) => str.charAt(Math.floor(random() * str.length));

    switch (format) {
        case 'EAN13': {
            let baseData = '';
            for (let i = 0; i < 12; i++) {
                baseData += getRandomChar(nums);
            }
            const checksum = calcularChecksum(baseData, true);
            return baseData + checksum;
        }
        case 'UPC': {
            let baseData = '';
            for (let i = 0; i < 11; i++) {
                baseData += getRandomChar(nums);
            }
            const checksum = calcularChecksum(baseData, false);
            return baseData + checksum;
        }
        case 'CODE128':
        default: {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            let charPart = '';
            let numPart = '';
            for (let i = 0; i < 3; i++) {
                charPart += getRandomChar(chars);
            }
            for (let i = 0; i < 5; i++) {
                numPart += getRandomChar(nums);
            }
            return `${charPart}-${numPart}`;
        }
    }
}