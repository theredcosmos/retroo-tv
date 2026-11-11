-- V4: language tag for the 2:1 Bollywood/Hollywood rotation (gemini.md rule 8).
-- Runs unchanged on Oracle and H2 (MODE=Oracle). Existing rows default to 'en'; V3's songs are Hindi.
ALTER TABLE SONGS ADD (LANG VARCHAR2(2) DEFAULT 'en' NOT NULL);

UPDATE SONGS SET LANG = 'hi' WHERE VIDEO_ID IN (
    '3wAnXhoCBXQ',
    'mfEQgoVi7P4',
    'RVeLrwoB_xw',
    'GUn3P5QyLRY',
    'qfCt1UZAXMQ',
    '-W2dagktUp0',
    'AMuRRXCuy-4',
    'ByAbV-MKDgs',
    'dx57HiK1wUg',
    'IgKdXLfxgQQ',
    'FEvBiayarlc',
    '7JdEZoffm-Q',
    '32tNhs2Vk8U',
    'qOZ_AjkKZWc',
    'cNV5hLSa9H8',
    'bKZTnnFU9HA',
    'iSUK1QoK9-E',
    'H5sheEWfsOQ',
    'lZ2PhyBF3GQ',
    'g0eO74UmRBs',
    'mt9xg0mmt28',
    'qoq8B8ThgEM',
    '4dsFQFCvVGU',
    'SS3lIQdKP-A',
    '53l2DkivxJs',
    'IBvg3WeqP1U',
    'IJq0yyWug1k',
    '284Ov7ysmfA',
    'AEIVhBS6baE',
    'II2EO3Nw4m0',
    'FxAG_11PzCk',
    '4WRJHbL4dAk',
    'lpdRqn6xwiM',
    'BddP6PYo2gs',
    '3EJGAKPifNs',
    '3pz_bHeZLkg',
    'VAdGW7QDJiU',
    'ETMul5GVk_Y',
    'uTuchIYZdbM',
    'ri1Ar5nEq4s'
);

ALTER TABLE SONGS ADD CONSTRAINT CK_SONGS_LANG CHECK (LANG IN ('hi', 'en'));

-- Random picks filter by decade AND language.
CREATE INDEX IX_SONGS_DECADE_LANG ON SONGS (DECADE, LANG);
