-- modureader 分片库的冻结输入（只含 time / book / position 三类；schema 与实测一致，无 local_id 列）
CREATE TABLE IF NOT EXISTS modu_sync_records (
    kind TEXT NOT NULL,
    sync_id TEXT NOT NULL,
    clock INTEGER,
    revision INTEGER,
    deleted INTEGER NOT NULL DEFAULT 0,
    payload TEXT,
    narration TEXT,
    PRIMARY KEY (kind, sync_id)
);
INSERT INTO modu_sync_records (kind, sync_id, clock, revision, deleted, payload) VALUES
('book','b1',1,1,0,'{"title":"夜航西飞","author":"柏瑞尔·马卡姆","file_md5":"md5a","cover_path":"","create_time":0}'),
('book','b2',2,1,0,'{"title":"人类简史","author":"尤瓦尔·赫拉利","file_md5":"md5b","cover_path":"","create_time":0}'),
('book','b3',3,1,1,'{"title":"已删除的书","author":"","file_md5":"md5c","cover_path":"","create_time":0}'),
('time','t1',10,1,0,'{"book_id":"b1","date":"2026-11-20","reading_time":1200}'),
('time','t2',11,1,0,'{"book_id":"b1","date":"2026-11-21","reading_time":600}'),
('time','t3',12,1,0,'{"book_id":"b2","date":"2026-11-21","reading_time":900}'),
('time','t4',13,1,1,'{"book_id":"b2","date":"2026-11-21","reading_time":9999}'),
('time','t5',14,1,0,'{"book_id":"b3","date":"2026-11-22","reading_time":500}'),
('position','b1',15,1,0,'{"last_read_position":"p","reading_percentage":0.55}');
