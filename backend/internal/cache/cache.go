package cache

import (
	"sync"
	"time"
)

type entry struct {
	data      []byte
	expiresAt time.Time
}

// Store is a simple in-process TTL cache keyed by string.
type Store struct {
	mu    sync.RWMutex
	items map[string]entry
}

var Global = &Store{items: make(map[string]entry)}

func (s *Store) Get(key string) ([]byte, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, ok := s.items[key]
	if !ok || time.Now().After(e.expiresAt) {
		return nil, false
	}
	return e.data, true
}

func (s *Store) Set(key string, data []byte, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[key] = entry{data: data, expiresAt: time.Now().Add(ttl)}
}

func (s *Store) Delete(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.items, key)
}
