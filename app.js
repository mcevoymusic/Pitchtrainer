document.getElementById('startButton').addEventListener('click', startPitchDetection);

const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const standardA = 440;
const pitchData = [];
const labels = Array(50).fill('');
let pitchChart = null;

let lastStablePitch = null;
let pitchStabilityThreshold = 1; // Number of consecutive frames needed for pitch to be considered stable
let stablePitchFrames = 0; // Counter for consecutive frames with the same pitch
let silenceThreshold = 0.01; // Silence threshold for RMS

// Function to calculate semitone ratio
function frequencyDifferenceInSemitones(frequency1, frequency2) {
    return 12 * Math.log2(frequency1 / frequency2);
}

const noteFrequencies = {
    "C": [16.35, 32.7, 65.41, 130.81, 261.63, 523.25, 1046.5, 2093, 4186],
    "D": [18.35, 36.71, 73.42, 146.83, 293.66, 587.33, 1174.66, 2349.32, 4698.63],
    "D#": [19.45, 38.89, 77.78, 155.56, 311.13, 622.25, 1244.51, 2489, 4978],
    "F": [21.83, 43.65, 87.31, 174.61, 349.23, 698.46, 1396.91, 2793.83, 5587.65],
    "G": [24.5, 49, 98, 196, 392, 783.99, 1567.98, 3135.96, 6271.93],
    "A": [27.5, 55, 110, 220, 440, 880, 1760, 3520, 7040],
    "A#": [29.14, 58.27, 116.54, 233.08, 466.16, 932.33, 1864.66, 3729.31, 7458.62]
};

const noteColors = {
    "C": 'rgba(255, 165, 0, 0.8)',     // orange
    "D": 'rgba(255, 255, 0, 0.8)',     // yellow
    "D#": 'rgba(127, 255, 0, 0.8)',    // #7FFF00
    "F": 'rgba(70, 130, 180, 0.8)',    // #4682B4
    "G": 'rgba(128, 0, 128, 0.8)',     // purple
    "A": 'rgba(255, 105, 180, 0.8)',   // #FF69B4
    "A#": 'rgba(255, 0, 0, 0.8)',      // red
};

function createChart() {
    if (pitchChart) {
        return;
    }
    
    const ctx = document.getElementById('pitchChart').getContext('2d');
    pitchChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '',
                data: pitchData,
                borderColor: 'rgba(255, 255, 255, 1)', // Line color is white
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
                    min: 174.61,    // Fixed minimum frequency
                    max: 1174.66,   // Fixed maximum frequency
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
                    annotations: generateAnnotations()
                }
            },
            layout: {
                backgroundColor: '#000000'  // Chart background black
            }
        }
    });
}

function generateAnnotations() {
    const annotations = [];
    for (const note in noteFrequencies) {
        noteFrequencies[note].forEach(frequency => {
            if (frequency >= 174.61 && frequency <= 1174.66) {  // Apply only within the fixed window
                let yMin = frequency / Math.pow(2, 5 / 1200);
                let yMax = frequency * Math.pow(2, 5 / 1200);
                if (["A#", "C", "D", "D#", "F", "G", "A"].includes(note)) {
                    yMin = frequency / Math.pow(2, 10 / 1200);
                    yMax = frequency * Math.pow(2, 10 / 1200);
                }
                annotations.push({
                    type: 'box',
                    yMin: yMin,
                    yMax: yMax,
                    backgroundColor: noteColors[note],
                    z: -1
                });
            }
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

    createChart();

    function detectPitch() {
        analyser.getFloatTimeDomainData(dataArray);
        const { pitch, rms } = autoCorrelate(dataArray, audioContext.sampleRate);

        // Only process pitch if above silence threshold
        if (rms >= silenceThreshold && pitch !== -1 && pitch >= 174.61 && pitch <= 1174.66) {
            // Check if the pitch is stable within a semitone range
            if (lastStablePitch && Math.abs(frequencyDifferenceInSemitones(pitch, lastStablePitch)) < 1) {
                stablePitchFrames++;
            } else {
                stablePitchFrames = 0;
            }

            if (stablePitchFrames >= pitchStabilityThreshold) {
                // Only update the display and chart if the pitch is stable within a semitone for a few frames
                document.getElementById('pitchDisplay').textContent = `${Math.round(pitch)} Hz | ${getNoteFromPitch(pitch)}`;

                pitchData.push(pitch);
                if (pitchData.length > 50) {
                    pitchData.shift();
                }
                updateChart(pitch);
                pitchChart.update();
            }

            lastStablePitch = pitch; // Update the last stable pitch value
        } else if (rms < silenceThreshold) {
            // Reset stable frames if silence is detected
            stablePitchFrames = 0;
        }

        requestAnimationFrame(detectPitch);
    }

    detectPitch();
}

function updateChart(pitch) {
    pitchChart.options.scales.y.min = 174.61;   // Keep fixed min value
    pitchChart.options.scales.y.max = 1174.66;  // Keep fixed max value

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

    // Calculate RMS (amplitude/loudness)
    for (let i = 0; i < SIZE; i++) {
        let val = buffer[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < silenceThreshold)
        return { pitch: -1, rms };  // Return -1 pitch if silent

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
            return { pitch: sampleRate / (bestOffset + (8 * shift)), rms };
        }
        lastCorrelation = correlation;
    }
    if (bestCorrelation > 0.01) {
        return { pitch: sampleRate / bestOffset, rms };
    }
    return { pitch: -1, rms };
}

function getNoteFromPitch(frequency) {
    let noteNum = 12 * (Math.log(frequency / standardA) / Math.log(2));
    noteNum = Math.round(noteNum) + 69;
    return noteStrings[noteNum % 12] + Math.floor(noteNum / 12 - 1);
}
