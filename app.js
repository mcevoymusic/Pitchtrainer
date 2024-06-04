document.getElementById('startButton').addEventListener('click', startPitchDetection);

const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const standardA = 440;
const pitchData = [];
const labels = Array(50).fill('');
const smoothingWindowSize = 5;
const threshold = 50;
let recentPitches = [];
let pitchChart = null;

const noteFrequencies = {
    "C": [16.35, 32.7, 65.41, 130.81, 261.63, 523.25, 1046.5, 2093, 4186],
    "C#": [17.32, 34.65, 69.3, 138.59, 277.18, 554.37, 1108.73, 2217.46, 4434.92],
    "D": [18.35, 36.71, 73.42, 146.83, 293.66, 587.33, 1174.66, 2349.32, 4698.63],
    "D#": [19.45, 38.89, 77.78, 155.56, 311.13, 622.25, 1244.51, 2489, 4978],
    "E": [20.6, 41.2, 82.41, 164.81, 329.63, 659.25, 1318.51, 2637, 5274],
    "F": [21.83, 43.65, 87.31, 174.61, 349.23, 698.46, 1396.91, 2793.83, 5587.65],
    "F#": [23.12, 46.25, 92.5, 185, 369.99, 739.99, 1479.98, 2959.96, 5919.91],
    "G": [24.5, 49, 98, 196, 392, 783.99, 1567.98, 3135.96, 6271.93],
    "G#": [25.96, 51.91, 103.83, 207.65, 415.3, 830.61, 1661.22, 3322.44, 6644.88],
    "A": [27.5, 55, 110, 220, 440, 880, 1760, 3520, 7040],
    "A#": [29.14, 58.27, 116.54, 233.08, 466.16, 932.33, 1864.66, 3729.31, 7458.62],
    "B": [30.87, 61.74, 123.47, 246.94, 493.88, 987.77, 1975.53, 3951, 7902.13]
};

const noteColors = {
    "C": 'rgba(255, 165, 0, 0.8)',     // orange
    "C#": 'rgba(255, 179, 71, 0.8)',   // #FFB347
    "D": 'rgba(255, 255, 0, 0.8)',     // yellow
    "D#": 'rgba(127, 255, 0, 0.8)',    // #7FFF00 (Eb is equivalent to D#)
    "E": 'rgba(133, 191, 115, 0.8)',   // #85BF73
    "F": 'rgba(70, 130, 180, 0.8)',    // #4682B4
    "F#": 'rgba(0, 191, 255, 0.8)',    // #00BFFF
    "G": 'rgba(128, 0, 128, 0.8)',     // purple
    "G#": 'rgba(218, 112, 214, 0.8)',  // #DA70D6
    "A": 'rgba(255, 105, 180, 0.8)',   // #FF69B4
    "A#": 'rgba(255, 0, 0, 0.8)',      // red (Bb is equivalent to A#)
    "B": 'rgba(255, 99, 71, 0.8)'      // #FF6347
};

function createChart() {
    const ctx = document.getElementById('pitchChart').getContext('2d');
    pitchChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Pitch (Hz)',
                data: pitchData,
                borderColor: 'rgba(255, 255, 255, 1)', // Change line color to white
                borderWidth: 2,
                pointRadius: 0,
                fill: false,
                lineTension: 0.2
            }]
        },
        options: {
            animation: false,
            scales: {
                x: {
                    display: false
                },
                y: {
                    type: 'logarithmic',
                    min: 27.5,
                    max: 4186,
                    grid: {
                        display: false
                    },
                    ticks: {
                        display: false
                    }
                }
            },
            plugins: {
                annotation: {
                    annotations: generateAnnotations()  // Ensure annotations are added here
                }
            },
            layout: {
                backgroundColor: '#000000' // Set chart background to black
            },
            plugins: {
                afterDatasetsDraw: function(chart) {
                    const ctx = chart.ctx;
                    const dataset = chart.data.datasets[0];
                    ctx.save();
                    ctx.strokeStyle = dataset.borderColor;
                    ctx.lineWidth = dataset.borderWidth;
                    ctx.beginPath();
                    for (let i = 0; i < dataset.data.length; i++) {
                        const model = chart.getDatasetMeta(0).data[i]._model;
                        if (i === 0) {
                            ctx.moveTo(model.x, model.y);
                        } else {
                            ctx.lineTo(model.x, model.y);
                        }
                    }
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }
    });
}

function generateAnnotations() {
    const annotations = [];
    for (const note in noteFrequencies) {
        noteFrequencies[note].forEach(frequency => {
            let yMin = frequency / Math.pow(2, 5 / 1200);
            let yMax = frequency * Math.pow(2, 5 / 1200);
            if (["A#", "C", "D", "D#", "F", "G", "A"].includes(note)) {
                yMin = frequency / Math.pow(2, 10 / 1200); // Make the zone twice as large
                yMax = frequency * Math.pow(2, 10 / 1200); // Make the zone twice as large
            }
            annotations.push({
                type: 'box',
                yMin: yMin,
                yMax: yMax,
                backgroundColor: noteColors[note],
                z: -1  // Ensure annotations are below the line
            });
        });
    }
    return annotations;
}

async function startPitchDetection() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    source.connect(analyser);

    analyser.fftSize = 2048;
    const bufferLength = analyser.fftSize;
    const dataArray = new Float32Array(bufferLength);

    if (!pitchChart) {
        createChart();
    }

    function detectPitch() {
        analyser.getFloatTimeDomainData(dataArray);
        const pitch = autoCorrelate(dataArray, audioContext.sampleRate);

        if (pitch !== -1) {
            const smoothedPitch = smoothPitch(pitch);
            if (smoothedPitch !== null) {
                document.getElementById('pitchDisplay').textContent = `Pitch: ${Math.round(smoothedPitch)} Hz`;
                const note = getNoteFromPitch(smoothedPitch);
                const [noteName, octave] = note.split(/(\d+)/);
                document.getElementById('noteDisplay').textContent = `Note: ${note}`;

                const transposedBb = transposeNoteBb(noteName);
                const transposedEb = transposeNoteEb(noteName);
                document.getElementById('noteDisplay').textContent += ` (Bb: ${transposedBb}, Eb: ${transposedEb})`;

                if (smoothedPitch) {
                    pitchData.push(smoothedPitch);
                    if (pitchData.length > 50) {
                        pitchData.shift();
                    }
                    updateChart(smoothedPitch);
                    pitchChart.update();
                }
            }
        }

        requestAnimationFrame(detectPitch);
    }

    detectPitch();
}

function smoothPitch(pitch) {
    recentPitches.push(pitch);
    if (recentPitches.length > smoothingWindowSize) {
        recentPitches.shift();
    }
    const avgPitch = recentPitches.reduce((sum, val) => sum + val, 0) / recentPitches.length;

    if (Math.abs(pitch - avgPitch) < threshold) {
        return avgPitch;
    } else {
        return null;
    }
}

function updateChart(pitch) {
    const centerFrequency = pitch;
    const yMin = centerFrequency / Math.pow(2, 3 / 12);
    const yMax = centerFrequency * Math.pow(2, 3 / 12);

    pitchChart.options.scales.y.min = yMin;
    pitchChart.options.scales.y.max = yMax;
    pitchChart.options.plugins.annotation.annotations = generateAnnotations();
    pitchChart.update();
}

function autoCorrelate(buffer, sampleRate) {
    const SIZE = buffer.length;
    let maxSamples = Math.floor(SIZE / 2);
    let bestOffset = -1;
    let bestCorrelation = 0;
    let rms = 0;
    let foundGoodCorrelation = false;
    let correlations = new Array(maxSamples);

    for (let i = 0; i < SIZE; i++) {
        let val = buffer[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01)
        return -1;

    let lastCorrelation = 1;
    for (let offset = 0; offset < maxSamples; offset++) {
        let correlation = 0;

        for (let i = 0; i < maxSamples; i++) {
            correlation += Math.abs((buffer[i]) - (buffer[i + offset]));
        }
        correlation = 1 - (correlation / maxSamples);
        correlations[offset] = correlation;
        if ((correlation > 0.9) && (correlation > lastCorrelation)) {
            foundGoodCorrelation = true;
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestOffset = offset;
            }
        } else if (foundGoodCorrelation) {
            let shift = (correlations[bestOffset + 1] - correlations[bestOffset - 1]) / correlations[bestOffset];
            return sampleRate / (bestOffset + (8 * shift));
        }
        lastCorrelation = correlation;
    }
    if (bestCorrelation > 0.01) {
        return sampleRate / bestOffset;
    }
    return -1;
}

function getNoteFromPitch(frequency) {
    let noteNum = 12 * (Math.log(frequency / standardA) / Math.log(2));
    noteNum = Math.round(noteNum) + 69;
    return noteStrings[noteNum % 12] + Math.floor(noteNum / 12 - 1);
}

function getFrequencyFromNoteString(note) {
    const [noteName, octave] = note.split(/(\d+)/);
    const noteIndex = noteStrings.indexOf(noteName);
    return noteFrequencies[noteName][octave - 1];
}

function transposeNoteBb(noteName) {
    const transpositions = {
        "C": "D", "C#": "D#", "D": "E", "D#": "F", "E": "F#", "F": "G",
        "F#": "G#", "G": "A", "G#": "A#", "A": "B", "A#": "C", "B": "C#"
    };
    return transpositions[noteName];
}

function transposeNoteEb(noteName) {
    const transpositions = {
        "C": "A", "C#": "A#", "D": "B", "D#": "C", "E": "C#", "F": "D",
        "F#": "D#", "G": "E", "G#": "F", "A": "F#", "A#": "G", "B": "G#"
    };
    return transpositions[noteName];
}

// Initialize the chart with middle C (C4)
createChart();
updateChart(261.63);  // Initialize annotations
