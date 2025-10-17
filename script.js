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
const pdfReplicateUploadInput = document.getElementById('pdfReplicateUpload');
const replicateBtn = document.getElementById('replicateBtn');

// Conjunto para almacenar series existentes y evitar duplicados
let existingSerials = new Set();

// --- Lógica de la Interfaz ---
paperSizeSelect.addEventListener('change', () => {
    customPaperSizeDiv.style.display = paperSizeSelect.value === 'custom' ? 'grid' : 'none';
});

// --- LÓGICA PARA LEER PDFS (EVITAR DUPLICADOS) ---
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

            if (metadata.info && metadata.info.Keywords) {
                const seed = metadata.info.Keywords;
                if (!isNaN(seed) && seed.trim() !== '') {
                    seedsFound++;
                    const configData = JSON.parse(metadata.info.Subject || '{}');
                    const quantity = configData.quantity;
                    const barcodeType = configData.barcodeType;

                    if (quantity > 0 && barcodeType) {
                        const prng = mulberry32(parseInt(seed, 10));
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


// --- Lógica Principal de Generación de PDF NUEVO ---
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


// --- LÓGICA PARA REPLICAR PDF ---
replicateBtn.addEventListener('click', async () => {
    const files = pdfReplicateUploadInput.files;
    if (files.length !== 1) {
        alert("Por favor, selecciona un único archivo PDF para procesar.");
        return;
    }

    loader.style.display = 'block';

    try {
        const file = files[0];
        const fileReader = new FileReader();
        await new Promise((resolve, reject) => {
            fileReader.onload = resolve;
            fileReader.onerror = reject;
            fileReader.readAsArrayBuffer(file);
        });

        const typedarray = new Uint8Array(fileReader.result);
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        const metadata = await pdf.getMetadata();

        if (metadata.info && metadata.info.Subject) {
            const configData = JSON.parse(metadata.info.Subject);

            // DECISIÓN: ¿Es un comprobante con items o una réplica normal?
            if (configData.type === 'predefined' && configData.items) {
                // CASO 1: Es un comprobante. Extraemos datos del nombre del archivo.
                const filename = file.name.replace('.pdf', '');
                const parts = filename.split('_');
                let sapTrabajador = 'N_A';
                let nombreTrabajador = 'N_A';
                let nameParts = [];
                let sapFound = false;

                // Empezamos a buscar después de "Comprobante_Retiro_" o "Comprobante_Devolucion_"
                for (let i = 2; i < parts.length; i++) {
                    // El primer número que encontramos es el SAP del trabajador
                    if (!isNaN(parseInt(parts[i])) && !sapFound) {
                        sapTrabajador = parts[i];
                        sapFound = true;
                    } else if (!sapFound) {
                        nameParts.push(parts[i]);
                    }
                }
                if (nameParts.length > 0) {
                    nombreTrabajador = nameParts.join('_');
                }

                alert("Comprobante detectado. Se generarán etiquetas para los materiales encontrados.");
                generatePdfFromItems(configData.items, nombreTrabajador, sapTrabajador);

            } else if (metadata.info.Keywords) {
                // CASO 2: Es una réplica normal basada en semilla.
                const seed = metadata.info.Keywords;
                Object.keys(configData).forEach(key => {
                    const element = document.getElementById(key);
                    if (element) {
                        element.value = configData[key];
                    }
                });
                paperSizeSelect.dispatchEvent(new Event('change'));
                generatePdf(parseInt(seed, 10));
            } else {
                alert("Este PDF no es un comprobante válido ni contiene una semilla para replicar.");
            }
        } else {
            alert("Este PDF no contiene los metadatos necesarios.");
        }
    } catch (error) {
        console.error("Error al procesar el PDF:", error);
        alert("Ocurrió un error al leer el PDF. Revisa la consola.");
    } finally {
        loader.style.display = 'none';
    }
});

// --- FUNCIÓN PARA GENERAR DESDE COMPROBANTE (CORREGIDA) ---
function generatePdfFromItems(items, nombreTrabajador, sapTrabajador) {
    const { jsPDF } = window.jspdf;
    const config = {
        paperSize: document.getElementById('paperSize').value,
        customWidth: parseFloat(document.getElementById('customWidth').value),
        customHeight: parseFloat(document.getElementById('customHeight').value),
        labelWidth: parseFloat(document.getElementById('labelWidth').value),
        labelHeight: parseFloat(document.getElementById('labelHeight').value),
        marginTop: parseFloat(document.getElementById('marginTop').value),
        marginLeft: parseFloat(document.getElementById('marginLeft').value),
        hSpacing: parseFloat(document.getElementById('hSpacing').value),
        vSpacing: parseFloat(document.getElementById('vSpacing').value),
        barcodeType: document.getElementById('barcodeType').value,
        barcodeHeight: parseFloat(document.getElementById('barcodeHeight').value),
        fontSize: parseFloat(document.getElementById('fontSize').value),
        quantity: items.length,
    };

    let paperWidth, paperHeight;
    if (config.paperSize === 'custom') {
        paperWidth = config.customWidth;
        paperHeight = config.customHeight;
    } else {
        const tempDoc = new jsPDF({ unit: 'mm', format: config.paperSize });
        paperWidth = tempDoc.internal.pageSize.getWidth();
        paperHeight = tempDoc.internal.pageSize.getHeight();
    }

    if (!validarConfiguracion(config, paperWidth, paperHeight)) return;

    const doc = new jsPDF({ unit: 'mm', format: [paperWidth, paperHeight] });

    let x = config.marginLeft, y = config.marginTop;

    for (let i = 0; i < items.length; i++) {
        const item = items[i], newSerial = item.serial, description = item.description;
        const canvas = document.createElement('canvas');
        try {
            JsBarcode(canvas, newSerial, {
                format: config.barcodeType, width: 2, height: config.barcodeHeight * 3.78,
                displayValue: true, text: newSerial, fontOptions: "bold",
                fontSize: config.fontSize * 2, margin: 10
            });
        } catch (error) {
            alert(`Error al generar código de barras para el serial "${newSerial}".`);
            return;
        }

        const barcodeDataUrl = canvas.toDataURL('image/png');

        // --- ZONA DE LA CORRECCIÓN ---
        // El texto superior ahora es ÚNICAMENTE la descripción (ej: "3360-zzzzzz").
        const topText = description;
        if (topText) {
            doc.setFontSize(config.fontSize > 2 ? config.fontSize - 1 : 2);
            doc.text(topText, x + (config.labelWidth / 2), y + 4, { align: 'center' });
        }
        // --- FIN DE LA CORRECCIÓN ---

        const imageY = description ? y + 5 : y;
        const imageHeight = config.labelHeight - (description ? 5 : 0);
        doc.addImage(barcodeDataUrl, 'PNG', x, imageY, config.labelWidth, imageHeight);

        if (i < items.length - 1) {
            x += config.labelWidth + config.hSpacing;
            if (x + config.labelWidth > paperWidth) {
                x = config.marginLeft;
                y += config.labelHeight + config.vSpacing;
                if (y + config.labelHeight > paperHeight) {
                    doc.addPage();
                    x = config.marginLeft;
                    y = config.marginTop;
                }
            }
        }
    }

    const fechaActual = new Date().toISOString().slice(0, 10);
    const filename = `etiquetas_Retiro_${nombreTrabajador}_${sapTrabajador}_${fechaActual}.pdf`;
    doc.save(filename);
}

// --- Generador de Números Pseudo-Aleatorios (PRNG) ---
function mulberry32(a) {
    return function() {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// --- FUNCIÓN DE VALIDACIÓN "A PRUEBA DE BALAS" ---
function validarConfiguracion(config, paperWidth, paperHeight) {
    if (config.labelWidth <= 0 || config.labelHeight <= 0 || config.quantity <= 0) {
        alert("El ancho/alto de la etiqueta y la cantidad deben ser mayores que cero.");
        return false;
    }
    if (config.marginTop < 0 || config.marginLeft < 0 || config.hSpacing < 0 || config.vSpacing < 0 || config.barcodeHeight <= 0 || config.fontSize <=0) {
        alert("Los márgenes, espaciados, altura de código y tamaño de fuente no pueden ser negativos o cero.");
        return false;
    }
    if (config.marginLeft >= paperWidth || config.marginTop >= paperHeight) {
        alert("Error: El margen es más grande que el propio papel.");
        return false;
    }
    if (config.labelWidth + config.marginLeft > paperWidth || config.labelHeight + config.marginTop > paperHeight) {
        alert("Error de medidas: La primera etiqueta no cabe en el papel con los márgenes especificados.");
        return false;
    }
    if (config.barcodeHeight >= config.labelHeight) {
        alert("Error de configuración: La 'Altura del Código' no puede ser mayor o igual al 'Alto Etiqueta'.");
        return false;
    }
    return true;
}

// --- FUNCIÓN DE GENERACIÓN DE PDF ---
function generatePdf(seedToUse = null) {
    const { jsPDF } = window.jspdf;

    const config = {
        paperSize: document.getElementById('paperSize').value,
        customWidth: parseFloat(document.getElementById('customWidth').value),
        customHeight: parseFloat(document.getElementById('customHeight').value),
        labelWidth: parseFloat(document.getElementById('labelWidth').value),
        labelHeight: parseFloat(document.getElementById('labelHeight').value),
        marginTop: parseFloat(document.getElementById('marginTop').value),
        marginLeft: parseFloat(document.getElementById('marginLeft').value),
        hSpacing: parseFloat(document.getElementById('hSpacing').value),
        vSpacing: parseFloat(document.getElementById('vSpacing').value),
        barcodeType: document.getElementById('barcodeType').value,
        barcodeHeight: parseFloat(document.getElementById('barcodeHeight').value),
        fontSize: parseFloat(document.getElementById('fontSize').value),
        quantity: parseInt(document.getElementById('quantity').value, 10),
    };

    let paperFormat, paperWidth, paperHeight;
    if (config.paperSize === 'custom') {
        paperWidth = config.customWidth;
        paperHeight = config.customHeight;
        paperFormat = [paperWidth, paperHeight];
    } else {
        paperFormat = config.paperSize;
        const tempDoc = new jsPDF({ unit: 'mm', format: paperFormat });
        paperWidth = tempDoc.internal.pageSize.getWidth();
        paperHeight = tempDoc.internal.pageSize.getHeight();
    }

    if (!validarConfiguracion(config, paperWidth, paperHeight)) {
        return;
    }

    // --- ZONA DE LA CORRECCIÓN ---
    // Determinamos la orientación correcta para jsPDF
    let orientation = 'portrait'; // por defecto es vertical
    if (paperWidth > paperHeight) {
        orientation = 'landscape'; // si es más ancho que alto, es horizontal
    }

    const doc = new jsPDF({
        orientation: orientation,
        unit: 'mm',
        format: paperFormat
    });
    // --- FIN DE LA CORRECCIÓN ---

    const seed = seedToUse || Date.now();
    const prng = mulberry32(seed);
    let x = config.marginLeft;
    let y = config.marginTop;
    const newlyGeneratedSerials = [];

    for (let i = 0; i < config.quantity; i++) {
        let newSerial;
        if (seedToUse) {
            newSerial = generateRandomSerial(config.barcodeType, prng);
        } else {
            do {
                newSerial = generateRandomSerial(config.barcodeType, prng);
            } while (existingSerials.has(newSerial));
        }

        newlyGeneratedSerials.push(newSerial);
        if (!seedToUse) { existingSerials.add(newSerial); }

        const canvas = document.createElement('canvas');
        try {
            JsBarcode(canvas, newSerial, {
                format: config.barcodeType,
                width: 2,
                height: config.barcodeHeight * 3.78,
                displayValue: true, text: newSerial,
                fontOptions: "bold", fontSize: config.fontSize * 2,
                margin: 10
            });
        } catch (error) {
            alert(`Error al generar el código de barras...`);
            return;
        }

        const barcodeDataUrl = canvas.toDataURL('image/png');
        doc.addImage(barcodeDataUrl, 'PNG', x, y, config.labelWidth, config.labelHeight);

        if (i < config.quantity - 1) {
            x += config.labelWidth + config.hSpacing;
            if (x + config.labelWidth > paperWidth) {
                x = config.marginLeft;
                y += config.labelHeight + config.vSpacing;
                if (y + config.labelHeight > paperHeight) {
                    doc.addPage();
                    x = config.marginLeft;
                    y = config.marginTop;
                }
            }
        }
    }

    if (newlyGeneratedSerials.length > 0) {
        const configToSave = {
            paperSize: config.paperSize, customWidth: config.customWidth,
            customHeight: config.customHeight, labelWidth: config.labelWidth,
            labelHeight: config.labelHeight, marginTop: config.marginTop,
            marginLeft: config.marginLeft, hSpacing: config.hSpacing,
            vSpacing: config.vSpacing, barcodeType: config.barcodeType,
            barcodeHeight: config.barcodeHeight, fontSize: config.fontSize,
            quantity: config.quantity,
        };
        doc.setDocumentProperties({
            title: 'Etiquetas de Códigos de Barras',
            subject: JSON.stringify(configToSave),
            author: 'GervaSoft E.I.R.L.',
            keywords: seed.toString(),
            creator: 'Generador de Etiquetas Web'
        });
    }

    const filename = seedToUse ? `replica_${seed}.pdf` : `etiquetas_${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
}

function calcularChecksum(data, isEan13) {
    let sum1 = 0, sum2 = 0;
    const multiplier1 = isEan13 ? 1 : 3;
    const multiplier2 = isEan13 ? 3 : 1;
    for (let i = 0; i < data.length; i++) {
        if ((i + 1) % 2 !== 0) { sum1 += parseInt(data[i], 10); }
        else { sum2 += parseInt(data[i], 10); }
    }
    const totalSum = (sum1 * multiplier1) + (sum2 * multiplier2);
    const checksum = (10 - (totalSum % 10)) % 10;
    return checksum;
}

function generateRandomSerial(format, prng) {
    const random = prng || Math.random;
    const nums = '0123456789';
    const getRandomChar = (str) => str.charAt(Math.floor(random() * str.length));

    switch (format) {
        case 'EAN13': {
            let baseData = '';
            for (let i = 0; i < 12; i++) { baseData += getRandomChar(nums); }
            const checksum = calcularChecksum(baseData, true);
            return baseData + checksum;
        }
        case 'UPC': {
            let baseData = '';
            for (let i = 0; i < 11; i++) { baseData += getRandomChar(nums); }
            const checksum = calcularChecksum(baseData, false);
            return baseData + checksum;
        }
        case 'CODE128':
        default: {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            let charPart = '', numPart = '';
            for (let i = 0; i < 3; i++) { charPart += getRandomChar(chars); }
            for (let i = 0; i < 5; i++) { numPart += getRandomChar(nums); }
            return `${charPart}-${numPart}`;
        }
    }
}