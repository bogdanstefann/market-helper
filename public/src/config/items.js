/* Item slots × rarities and the stat ranges of each code (from gameConfig.getGameConfig). */
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export const SLOTS = {
  weapon: { label: 'Weapon', stats: ['attack', 'criticalChance'],
    codes: { common: 'knife', uncommon: 'gun', rare: 'rifle', epic: 'sniper', legendary: 'tank', mythic: 'jet' },
    ranges: { knife: { attack: [21, 40], criticalChance: [1, 5] }, gun: { attack: [51, 60], criticalChance: [6, 10] },
      rifle: { attack: [71, 90], criticalChance: [11, 15] }, sniper: { attack: [101, 130], criticalChance: [16, 20] },
      tank: { attack: [141, 170], criticalChance: [26, 35] }, jet: { attack: [221, 300], criticalChance: [41, 50] } } },
  helmet: { label: 'Helmet', stats: ['criticalDamages'], ranges: { criticalDamages: [[1, 15], [16, 30], [31, 50], [71, 90], [91, 110], [121, 150]] } },
  chest:  { label: 'Chest',  stats: ['armor'],     ranges: { armor: [[1, 5], [6, 10], [11, 15], [21, 30], [36, 50], [56, 70]] } },
  pants:  { label: 'Pants',  stats: ['armor'],     ranges: { armor: [[1, 5], [6, 10], [11, 15], [21, 30], [36, 50], [56, 70]] } },
  gloves: { label: 'Gloves', stats: ['precision'], ranges: { precision: [[1, 5], [6, 10], [11, 15], [21, 25], [31, 40], [51, 60]] } },
  boots:  { label: 'Boots',  stats: ['dodge'],     ranges: { dodge: [[1, 5], [6, 10], [11, 15], [21, 25], [31, 40], [51, 60]] } },
};
export const ITEMS = {};
for (const [slot, def] of Object.entries(SLOTS)) {
  RARITIES.forEach((rarity, i) => {
    const code = def.codes ? def.codes[rarity] : `${slot}${i + 1}`;
    const ranges = {};
    for (const stat of def.stats) ranges[stat] = def.codes ? def.ranges[code][stat] : def.ranges[stat][i];
    ITEMS[code] = { code, slot, rarity, label: def.label, stats: def.stats, ranges };
  });
}

