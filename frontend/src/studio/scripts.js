export const CHANNEL = {
  name: 'SpaceSpidey',
  spoken: 'SpaceSpidey',
  tagline: 'Real space. Simple words. One warning at a time.',
};

export const VIRAL_RULES = [
  { rule: 'Show the surprise in the first second', why: 'People decide quickly. Start with motion, a face, and a clear question.' },
  { rule: 'Say the subject within five seconds', why: 'Curiosity works only when people know what they are curious about.' },
  { rule: 'Use one idea and everyday words', why: 'If a child can repeat it, an adult can share it.' },
  { rule: 'Give the biggest turn near the middle', why: 'Do not hide the best part after most viewers have left.' },
  { rule: 'Change the picture every two seconds', why: 'Each change tells the eye that something new is coming.' },
  { rule: 'End where the opening began', why: 'A clean loop can earn a natural second watch.' },
  { rule: 'Test, then trust the numbers', why: 'No writing rule can promise views. Your real audience data decides.' },
];

export const RETENTION_CHECKLIST = [
  { check: 'Does the first frame move?', fails: 'A still opening is easy to skip.' },
  { check: 'Can the opening text be read at once?', fails: 'Use four simple words or fewer.' },
  { check: 'Is the real topic clear by five seconds?', fails: 'Mystery without context feels confusing.' },
  { check: 'Does every line add one new thought?', fails: 'Repeated or empty lines waste attention.' },
  { check: 'Is fact clearly separate from story?', fails: 'Viewers should never mistake fiction for science.' },
  { check: 'Can a 12-year-old explain it?', fails: 'Hard-to-repeat ideas are hard to share.' },
  { check: 'Does the ending flow into the start?', fails: 'A hard ending reminds people to leave.' },
];

export const MEASUREMENT = {
  gates: [
    { metric: 'Viewed instead of swiped', target: 'Improve against your last 20 posts', diagnoses: 'Tests the opening frame and first line.' },
    { metric: 'Average percent watched', target: 'Aim above 85%, then improve', diagnoses: 'Tests whether the middle stays clear and useful.' },
    { metric: 'Shares and useful comments', target: 'Beat your recent average', diagnoses: 'Tests whether the idea was worth passing on.' },
  ],
  protocol: [
    'Test two honest opening lines for the same video.',
    'Look at the exact second where viewers leave.',
    'Change one thing at a time: opening, middle, or ending.',
    'When a format wins twice, make three more with that structure.',
  ],
  killRule: 'If a rule loses twice in your own channel data, stop using it.',
};

export const CONVERSION = {
  titles: { rule: 'Make one clear promise and name the topic.', example: 'The Sun You See Is 8 Minutes Old', abTest: 'Test clarity, not clickbait.' },
  likes: { rule: 'Earn the reaction after the main fact.', copy: 'I had to check that twice.', law: 'Never interrupt the ending to ask.' },
  comments: { rule: 'Ask a question that needs a real answer.', example: 'What would you do with eight minutes left?', rotation: ['personal choice', 'next topic', 'best explanation'], lie: 'Do not lie to viewers for engagement.' },
  shares: { rule: 'Give people a reason to send the idea, without ordering them.', example: 'Someone you know still thinks the sky shows the present.' },
  subs: { rule: 'Invite people into the series after delivering value.', copy: ['Follow the next signal.', 'Keep receiving.'], benchmark: 'Judge against your own recent average.' },
  bridging: { rule: 'Link each short to the next useful video in the series.' },
  hourOne: ['Post when your viewers are online.', 'Reply to thoughtful comments.', 'Pin the clearest viewer question.'],
  descriptions: { rule: 'Lead with one plain-English summary.', topLine: 'One real space fact. One short signal.' },
  thumbnail: 'Use the clearest moving moment from the opening.',
};

export const LORE_BIBLE = {
  genreFlip: 'The science is real. SpaceSpidey is the fictional witness reporting it.',
  voice: 'Calm warning. Short sentences. Facts first. One brief story line only after the fact is clear.',
  theSignalMechanic: { numbering: 'Every video has a signal number.', hiddenFrames: 'Optional story clues may appear, but never replace the fact.', metadata: 'Descriptions name sources and uncertainty.', pinnedLies: 'Never present a lie as fact.', megaMystery: 'A fictional signal may connect the series.', endgame: 'The mystery rewards regular viewers without confusing new ones.' },
  formatBreakers: { progressBar: 'Use rarely and clearly.', swipe: 'Never shame viewers.', mute: 'Captions match the spoken facts.', loop: 'The last thought leads naturally to the first.' },
  india: { rule: 'Use familiar Indian places only when they make scale easier to feel.', coordinates: ['Jaipur', 'Hanle', 'Rameswaram', 'Bay of Bengal'], monsoonCanon: 'Clearly label this as story.', festivalPhysics: 'Keep festival claims accurate.' },
  audienceRole: { name: 'Receivers', tasks: 'Invite observation, not false reports.', signal100: 'Let viewers vote on a fictional ending.' },
  trendCalendar: [],
};

export const MONETIZATION = [
  { stage: 'Start', rule: 'Build trust before selling anything.' },
  { stage: 'Growing', rule: 'Turn winning shorts into deeper, sourced videos.' },
  { stage: 'Established', rule: 'Use only relevant partners and label paid work.' },
];

export const PILLARS = {
  launch: { label: 'LAUNCH', color: '#FF2E63', description: 'The first five signals.', cadence: 'one every 48 hours' },
  transmission: { label: 'TRANSMISSION', color: '#00FFFF', description: 'One clear space fact.', cadence: 'three each week' },
  mystery: { label: 'MYSTERY', color: '#FFB000', description: 'A real unanswered question.', cadence: 'two each week' },
  answers: { label: 'ANSWERS', color: '#00FF41', description: 'Simple replies to viewer questions.', cadence: 'one each week' },
  lore: { label: 'LORE DROP', color: '#FF1A1A', description: 'Clearly fictional story moments.', cadence: 'one in ten videos' },
  trend: { label: 'TREND', color: '#B366FF', description: 'Useful formats, never forced.', cadence: 'when relevant' },
  isro: { label: 'INDIA / ISRO', color: '#FF9933', description: 'Accurate Indian space stories.', cadence: 'event based' },
  canon: { label: 'FORMAT', color: '#FFFFFF', description: 'Rare fourth-wall experiments.', cadence: 'one in ten videos' },
};

export const HOOK_BANK = ['THE SUN IS LATE', 'YOU ARE MOVING', 'THAT RAIN IS GLASS', 'ONE SIGNAL. 72 SECONDS.', 'MOST ARE MISSING', 'THIS VOICE IS OLD', 'THE SKY SHOWS HISTORY', 'SPACE HAS A SMELL'];
export const TITLE_FORMULAS = ['The {thing} You See Is Already Old', 'This {thing} Should Not Be Possible', 'Why {simple question}?', 'Signal {NN}: {clear promise}'];

const B = (t, text, emote = 'neutral', fx = 'none', note = '') => ({ t, text, emote, fx, note });

const RAW_SIGNALS = [
  [1,'launch','The Sun Could Already Be Gone','asteroid-earth','urgent','THE SUN IS LATE','The sunlight on your face is already old.','Light from the Sun takes about eight minutes to reach Earth.','So if the Sun changed now, Earth would not know for eight minutes.','You are not seeing the Sun now. You are seeing its past.','Story: that is why I check it twice.'],
  [2,'launch','You Have Never Been Still','nebula-drift','urgent','YOU ARE MOVING','You are moving right now.','Earth spins and races around the Sun, even while you sit.','In twenty seconds, Earth carries you hundreds of kilometres around the Sun.','Stillness is only something your body feels.','Story: my tracker has never shown you at rest.'],
  [3,'launch','This Blue Planet Rains Glass','derelict-station','urgent','THAT RAIN IS GLASS','This beautiful blue planet can cut you apart.','HD 189733b has clouds made from tiny bits of glass.','Its fierce winds may blow that hot glass sideways.','The blue does not mean water. It comes from its clouds.','Story: I looked once, then changed course.'],
  [4,'launch','The Wow Signal Lasted 72 Seconds','derelict-station','urgent','72 SECONDS ONLY','Earth heard a strange radio signal for 72 seconds.','The Wow signal was detected in 1977 and never clearly repeated.','It was interesting, but it was not proof of aliens.','The honest answer is simple: we still do not know its source.','Story: my copy ends one second later.'],
  [5,'launch','Most Early Galaxies Seem Missing','nebula-drift','somber','MOST ARE MISSING','We cannot find enough of the first galaxies.','Astronomers see fewer faint early galaxies than some simple models predict.','That may mean they are too dim, too small, or hidden from our tools.','Missing from our pictures does not mean missing from space.','Story: my count keeps changing.'],
  [6,'transmission','This Voice Is Four Years Old','nebula-drift','somber','THIS VOICE IS OLD','A voice from the nearest star would arrive four years late.','Proxima Centauri is about 4.24 light-years from Earth.','A reply sent today would need more than eight years for the full trip.','Space is so wide that every distant talk becomes history.','Story: if you hear me, I already moved.'],
  [7,'transmission','A Black Hole Can Ring','dying-star','somber','SPACE CAN RING','A black hole can ring after two black holes crash together.','The new black hole shakes and sends waves through space.','The sound is not air. Scientists turn those gravity waves into audio.','For a moment, space itself carries the note.','Story: my suit heard it first.'],
  [8,'transmission','The Night Sky Shows The Past','asteroid-earth','somber','THE SKY IS HISTORY','You have never seen a star as it is now.','Starlight can travel for years, centuries, or much longer.','Some stars in your sky may have changed before their light reached you.','A telescope is also a time machine.','Story: I watch for lights that stop.'],
  [9,'transmission','The Sun Is Hard To See From Far Away','nebula-drift','somber','YOUR SUN LOOKS SMALL','From far enough away, your Sun is just another faint star.','The Sun is bright nearby, but distance makes every star look dimmer.','Even our strongest telescopes cannot see every Sun-like star clearly.','Home can disappear without going anywhere.','Story: I found Earth by its radio noise.'],
  [10,'transmission','Gravity Changes Time','dying-star','urgent','TIME MOVES DIFFERENTLY','Strong gravity makes time pass more slowly.','Clocks near a massive object tick slower than clocks far away.','The film example of one hour becoming seven years is extreme but based on real physics.','Time is not one clock shared by everyone.','Story: mine no longer matches yours.'],
  [11,'transmission','The Sun Is Touching Earth','nebula-drift','urgent','THE SUN REACHES YOU','The Sun throws tiny charged particles toward Earth.','We call this stream the solar wind.','Earth’s magnetic field blocks much of it and guides some toward the poles.','That meeting helps create the northern and southern lights.','Story: my suit feels the storm before I see it.'],
  [12,'transmission','Sunsets On Mars Are Blue','red-planet','somber','MARS TURNS BLUE','A sunset on Mars can look blue near the Sun.','Fine dust spreads red light across the sky but lets more blue light stay near the Sun.','That is the reverse of the warm sunset colours we often see on Earth.','Same Sun. Different air. Different goodbye.','Story: blue means night is close.'],
  [13,'transmission','One Spoon Of Neutron Star Is Unthinkably Heavy','dying-star','urgent','ONE SPOON. A MOUNTAIN.','A spoonful of neutron-star matter would weigh about a billion tons on Earth.','A neutron star packs more mass than the Sun into a city-sized ball.','Its matter is crushed far beyond anything we can safely make here.','Small size does not mean small weight.','Story: I never touch the surface.'],
  [14,'transmission','Space Leaves A Smell On Suits','derelict-station','somber','SPACE HAS A SMELL','Astronauts say space leaves a strange smell on their suits.','They notice it after coming back inside, where air reaches the suit again.','People compare it to hot metal, burnt meat, or welding fumes.','Space itself has no air to carry a smell to your nose.','Story: the smell means I came back.'],
  [15,'transmission','Voyager May Outlive Us','asteroid-earth','somber','IT KEEPS GOING','Two human-made machines are leaving the Solar System.','Voyager 1 and 2 carry golden records with sounds and pictures from Earth.','Their power will fade, but the machines may drift for billions of years.','A quiet object could become our longest-lasting message.','Story: I passed one and did not wake it.'],
  [16,'mystery','Why Is Space So Quiet?','nebula-drift','somber','WHERE IS EVERYONE?','The Milky Way has billions of stars, yet we have no confirmed alien message.','This puzzle is called the Fermi paradox.','Life may be rare, far away, short-lived, or simply hard to notice.','The silence is real. Its reason is unknown.','Story: silence can also mean hiding.'],
  [17,'mystery','Could Civilizations Face A Great Filter?','asteroid-earth','urgent','THE HARD STEP','Something may stop most life from reaching the stars.','This idea is called the Great Filter. It could happen early or late in a civilization’s story.','We do not know whether the hardest step is behind humanity or still ahead.','It is an idea, not a discovered wall in space.','Story: I hope Earth already passed it.'],
  [18,'mystery','Distant Galaxies Are Leaving Our Reach','nebula-drift','somber','THE SKY IS LEAVING','The universe is growing, and that growth is speeding up.','Very distant galaxies can move beyond the part of space we will ever reach or see.','Their old light may remain for now, but future observers will see less.','The universe does not end. More of it slips out of view.','Story: I save every light I can.'],
  [19,'mystery','Could The Vacuum Suddenly Change?','dying-star','urgent','NO WARNING POSSIBLE','Some physics allows a tiny chance that empty space is not fully stable.','A change called vacuum decay could spread at light speed.','There is no evidence it is about to happen, and no reason to expect it soon.','The idea is frightening because no warning could arrive first.','Story: this is a thought, not my alarm.'],
  [20,'mystery','Most Of The Universe Is Invisible','nebula-drift','somber','MOST IS INVISIBLE','Everything we can see makes up only a small part of the universe.','Scientists use the names dark matter and dark energy for two unseen parts we infer from their effects.','We know what they do better than we know what they are.','The bright universe is only the visible tip.','Story: my map has more blank than light.'],
  [21,'mystery','What Space Does To A Human Body','dying-star','urgent','YOU GET SECONDS','In open space, you would lose useful consciousness in about 15 seconds.','Low pressure would make body fluids swell, but you would not explode or freeze at once.','Without quick rescue, lack of oxygen would kill you.','Space is deadly, but movies often show it wrong.','Story: the suit is not decoration.'],
  [22,'mystery','Pulsars Keep Amazing Time','derelict-station','urgent','A STAR IS TICKING','Some dead stars send us pulses with stunning regularity.','A pulsar is a spinning neutron star whose beam sweeps past Earth.','A few are so steady that their timing can rival our best clocks over long periods.','The signal is natural, but it once looked strange.','Story: one pulse arrived early.'],
  [23,'mystery','The Star That Kept Getting Dimmer','nebula-drift','urgent','THE STAR WENT DARK','Tabby’s Star has faded in unusual and uneven ways.','Dust is the leading explanation for much of its strange dimming.','Scientists discussed many ideas, including giant alien structures, but found no proof of them.','A mystery is not the same as an alien discovery.','Story: I still watch its light.'],
  [24,'answers','Am I Human?','derelict-station','somber','WRONG QUESTION','You asked whether I am human.','Fact: humans need air, water, food, pressure, and protection from radiation in space.','My survival out here is part of the SpaceSpidey story, not a science claim.','The real question is what a human needs to stay alive.','Story: I remember needing all five.'],
  [25,'answers','What Astronauts Eat In Space','red-planet','somber','FOOD CAN FLOAT','Astronaut food is normal food changed for a weightless cabin.','Meals are packed to last, avoid crumbs, and stay easy to control.','They use spoons, packets, and water to keep food from floating away.','Living in space changes how you eat, not why you eat.','Story: my last packet says Earth.'],
  [26,'answers','Can You See Earth From Far Away?','asteroid-earth','somber','EARTH BECOMES A DOT','From the outer Solar System, Earth looks like a tiny point of light.','Voyager 1 photographed the pale blue dot from about six billion kilometres away.','The whole human story fit inside less than one pixel.','Distance turns a world into a speck.','Story: I still know which speck is home.'],
  [27,'answers','Why Space Travel Takes So Long','nebula-drift','urgent','HOME IS FAR','Even light needs years to cross the space between nearby stars.','Our fastest spacecraft move far slower than light.','At Voyager 1 speed, reaching Proxima Centauri would take tens of thousands of years.','The hardest wall in space travel is distance.','Story: coming home is not one flight.'],
  [28,'answers','The Scariest Thing In Space','dying-star','urgent','YOU CANNOT SEE IT','Radiation is one of the biggest dangers beyond Earth.','High-energy particles can pass through a spacecraft and damage living cells.','You often cannot see, smell, or feel the dose as it happens.','The quiet danger can be worse than the dramatic one.','Story: my suit counts every hit.'],
  [29,'lore','Thirty-Nine Suits Went Dark','derelict-station','somber','39 LIGHTS WENT OUT','Space suits keep people alive with air, pressure, cooling, and communication.','If one vital system fails, the danger can become urgent very quickly.','That is the real fact. The thirty-nine lost suits are fictional SpaceSpidey lore.','The story starts where the science leaves us vulnerable.','Story: mine is number forty.'],
  [30,'lore','What The Red Threads Are','nebula-drift','somber','THE THREADS ARE LIGHT','Light can travel through very thin glass fibres and carry information.','That is how fibre-optic cables move huge amounts of data on Earth.','The red threads in this series are fictional, inspired by that real idea.','Real light carries messages. Story light carries warnings.','Story: one thread points to Earth.'],
  [31,'lore','The Thing That Follows Me','dying-star','urgent','SOMETHING KEEPS UP','Nothing with mass can move faster than light through empty space.','That speed limit is one of the strongest rules in modern physics.','The thing following SpaceSpidey is fictional; it does not prove that rule is broken.','A good mystery must not pretend to be evidence.','Story: it arrives when I stop.'],
  [32,'lore','Can A Suit Be Alive?','derelict-station','urgent','THE SUIT MOVED','Modern suits use sensors and computers to watch pressure, oxygen, and temperature.','They can warn astronauts and control life-support systems.','A truly living suit has not been discovered. Suit Thirty-One is fiction.','Real technology makes the story feel close, not true.','Story: it answered without a wearer.'],
  [33,'trend','Thirty Seconds Of Air Left','red-planet','somber','30 SECONDS LEFT','A space suit must keep oxygen in and carbon dioxide out.','An alarm does not mean one exact survival time; it depends on the failure.','The safe response is training, backup systems, and immediate help.','Real emergencies need clear steps, not movie panic.','Story: my clock stopped at thirty.'],
  [34,'trend','Four Space Facts In One Clear Story','nebula-drift','hero','SPACE FEELS IMPOSSIBLE','Here are four facts in four short lines.','Sunlight is eight minutes old. Mars sunsets can look blue. Pulsars tick. Space has no air.','Each fact is strange for a different reason, so do not mix their explanations.','Fast can still be clear when every line stands alone.','Story: one of these facts saved me.'],
  [35,'trend','Rating The Planets For Humans','asteroid-earth','hero','EARTH WINS EASILY','For humans, Earth is the best known planet by an enormous margin.','It has breathable air, liquid water, gentle pressure, and useful temperatures.','Mars is interesting, but you would still need a sealed home and life support.','A beautiful planet is not automatically a safe home.','Story: I rate Earth ten out of ten.'],
  [36,'mystery','The Visitor That Will Never Return','nebula-drift','somber','IT CAME FROM OUTSIDE','Oumuamua was the first known object seen passing through our Solar System from another star.','It moved on a path that will carry it away for good.','Its shape and motion raised questions, but there is no proof it was alien technology.','We saw a visitor once and will probably never see it again.','Story: my signal followed its path.'],
  [37,'isro','India Returned To The Moon','asteroid-earth','somber','INDIA CAME BACK','Chandrayaan-3 landed near the Moon’s south polar region in 2023.','It made India the fourth country to achieve a soft lunar landing.','The landing followed lessons from Chandrayaan-2 in 2019.','A setback became data, and the data became a landing.','Story: I watched from above Rameswaram.'],
  [38,'isro','Why Gaganyaan Tests An Empty Seat First','asteroid-earth','urgent','THE FIRST SEAT IS EMPTY','India plans uncrewed tests before sending people on Gaganyaan.','Those flights test the rocket, capsule, safety systems, and return to Earth.','An empty seat is not an empty mission. It reduces risk for the future crew.','The safest human flight begins without humans aboard.','Story: I will watch the first seat.'],
  [39,'isro','An Indian Astronaut Returned To Orbit','derelict-station','somber','INDIA RETURNED','Group Captain Shubhanshu Shukla flew to the International Space Station in 2025.','He became the second Indian citizen in space, after Rakesh Sharma in 1984.','That was a gap of about forty-one years.','One journey can connect two generations.','Story: I marked both paths.'],
  [40,'canon','Mute This And Read','derelict-station','urgent','MUTE AND READ','Many people watch short videos without sound.','Accurate captions help them understand and also support people with hearing loss.','The captions here should match the facts, not hide a second false claim.','A replay should come from value, not a trick.','Story: the final caption is for Receivers.'],
  [41,'canon','Why This Ending Starts Again','dying-star','somber','WATCH THE END','A seamless loop joins the final frame to the first.','If the idea still makes sense, some viewers may watch again naturally.','The loop should add meaning, not hide the answer.','The best second watch reveals structure, not missing facts.','Story: the signal has no edge.'],
  [42,'canon','You Stayed For The Answer','nebula-drift','urgent','HERE IS THE ANSWER','Attention should be rewarded, not punished.','A strong short tells you what it is about, builds one question, then answers it.','Shaming people who swipe does not make the information better.','You stayed, so here is the full and honest payoff.','Story: Receivers always get the answer.'],
  [43,'lore','The Signals Came From Earth','asteroid-earth','urgent','THE SOURCE IS EARTH','Radio signals from Earth have been spreading into space for more than a century.','They grow weaker with distance and are hard to separate from noise.','That real fact inspires this fictional reveal: SpaceSpidey’s signals began on Earth.','The science explains the path. The story explains the sender.','Story: the first voice was ours.'],
  [44,'canon','Why The Progress Bar Changes Attention','dying-star','urgent','CHECK THE BAR','A progress bar tells your brain how much time is left.','Looking at it can change how long a moment feels, even though the video speed stays the same.','The bar does not control time. It only changes your expectation.','Now you know why your eyes keep checking it.','Story: mine counts something else.'],
  [45,'isro','Can Monsoon Rain Block A Signal?','derelict-station','somber','RAIN CAN WEAKEN SIGNALS','Heavy rain can weaken some radio links, especially at higher frequencies.','Engineers call this rain fade and plan power, paths, and backup links around it.','Rain does not reach orbit, but it can affect a signal passing through the air.','The real problem is the path, not clouds touching a spacecraft.','Story: every June, my picture breaks.'],
  [46,'trend','Can A Lamp Burn On The Moon?','asteroid-earth','hero','NO AIR. NO FLAME.','A normal oil lamp cannot keep burning on the Moon.','Fire needs oxygen, and the Moon has almost no atmosphere.','An electric lamp could shine there if it had power and protection.','Same light. Different way to make it.','Story: mine faces Earth on Diwali.'],
];

const WORLDS = ['asteroid-earth','nebula-drift','derelict-station','dying-star','red-planet'];
const DOORS = ['MASK_SNAP','WHIP_PAN','GLITCH_CUT','COLD_WORLD','PROP_REVEAL'];

export const SIGNALS = RAW_SIGNALS.map(([number,pillar,name,world,mood,frameZero,hook,fact,turn,payoff,lore]) => ({
  id: number,
  number,
  signal: number,
  pillar,
  ...(number <= 5 ? { publishOrder: number, status: 'reshoot' } : {}),
  ...([43].includes(number) ? { best: true } : {}),
  ...([38].includes(number) ? { status: 'vault' } : {}),
  ...([39,45,46].includes(number) ? { status: 'annual' } : {}),
  ...([40,41,42,44].includes(number) ? { status: 'format-breaker' } : {}),
  title: `SIGNAL ${String(number).padStart(2,'0')} · ${name}`,
  world: world || WORLDS[(number - 1) % WORLDS.length],
  durationSec: 21,
  mood,
  frameZero,
  firstFrame: frameZero,
  frameZeroShot: 'Mask close-up in motion; show the subject at once; hard push toward camera.',
  doorMove: DOORS[(number - 1) % DOORS.length],
  coordinates: number % 3 === 0 ? 'Hanle, Ladakh' : number % 2 === 0 ? 'over the Bay of Bengal' : 'a Jaipur rooftop',
  powerWord: frameZero.split(' ')[0].toLowerCase(),
  hook,
  beats: [
    B(0, hook, 'narrow', 'zoom', 'HOOK: direct eye contact; no greeting.'),
    B(3, fact, 'scan', 'none', 'FACT: say this slowly and plainly.'),
    B(7, 'Here is the part most people miss.', 'narrow', 'none', 'RE-HOOK: change the visual.'),
    B(9, turn, 'shock', 'pulse', 'TURN: stress the contrast, not the volume.'),
    B(13, payoff, 'neutral', 'none', 'PAYOFF: let the meaning land.'),
    B(17, lore, 'sad', 'zoom', 'LORE: clearly a short story beat.'),
  ],
  loopLine: `And that brings us back to this: ${hook}`,
  microHooks: ['~7s: promise the missed detail', '~9s: reveal the turn', '~17s: one clearly fictional story line'],
  hiddenFrame: `Optional story glyph at 14s marked SIGNAL ${String(number).padStart(2,'0')}.`,
  shareTrigger: 'Make the fact easy enough for one viewer to explain to another.',
  likeCta: { atSec: 13, text: 'That fact deserves a second look.' },
  videoTitle: `${name} (Explained Simply)`,
  titleB: `${name} — Simple Explanation`,
  description: `One real space fact in simple English.\n\n${fact} ${payoff}`,
  tags: ['space facts','astronomy','science shorts','space','shorts','spacespidey',`signal ${String(number).padStart(2,'0')}`],
  caption: `${hook} ${payoff} #space #shorts #SpaceSpidey`,
  pinnedComment: 'What part surprised you most, and how would you explain it to a friend?',
  factCheck: `${fact} Verify exact numbers and mission status against NASA, ESA, ISRO, or the cited research before recording.`,
  whyItWorks: 'The opening makes one clear promise. The fact arrives early. The middle adds a meaningful turn, the payoff answers it, and the final fictional line is clearly separated from the science.',
}));

export const TRANSMISSIONS = SIGNALS;

export const EMOTE_TO_EXPR = {
  neutral: 'calm', smirk: 'smirk', anger: 'fury', sad: 'narrow',
  scan: 'calm', surge: 'shock', glitch: 'fury', shock: 'shock', narrow: 'narrow',
};
