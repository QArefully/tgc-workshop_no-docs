# QME-418 — Konfigurator Custom Blend

## Kontekst

Klienci hurtowi mogą stworzyć własną mieszankę proszkową o masie 25 kg z materiału bazowego i wybranych składników, a następnie kupić ją jak każdy inny produkt. Konfigurator jest dostępny z głównego menu kategorii bez logowania.

## Zadanie

Ta funkcja już istnieje. Przygotuj plan testów E2E z priorytetami, obejmujący konfigurator oraz dodawanie i edycję mieszanki w koszyku. Zakres tego ćwiczenia obejmuje AC1–AC5. Finalizacja zakupu, płatność, dostawa, rabaty i potwierdzenie zamówienia są poza zakresem.

Plan przygotuj wyłącznie na podstawie plików repozytorium. Nie otwieraj przeglądarki, nie uruchamiaj aplikacji ani testów, nie instaluj zależności i nie resetuj bazy danych. Nie implementuj testów ani nie zmieniaj aplikacji.

## Kryteria akceptacji

- **AC1 — Dodanie do koszyka:** Niezalogowany klient może wybrać materiał bazowy, dodać co najmniej jeden składnik, ustawić prawidłowe proporcje i dodać mieszankę jako jedną pozycję w koszyku, z widoczną ceną łączną. Może kontynuować zakupy i ma dostępną opcję przejścia do kasy. Sprawdzenie tej opcji ogranicza się do jej dostępności i celu nawigacji; przebieg finalizacji zakupu jest poza zakresem.
- **AC2 — Aktualizacja ceny na bieżąco:** Zmiana proporcji aktualizuje w podsumowaniu koszt materiałów i cenę łączną bez przeładowania strony. Opłata za mieszanie pozostaje stała. Koszt materiałów wynika z materiału bazowego, wybranych składników i proporcji, a cena łączna jest sumą kosztu materiałów i opłaty; wartości w podsumowaniu i koszyku są zgodne.
- **AC3 — Bezpieczeństwo:** Podsumowanie wskazuje, czy skonfigurowana mieszanka nadaje się do zastosowań spożywczych. Jeśli się nie nadaje, pokazuje widoczne i czytelne wskazówki dotyczące obchodzenia się z nią.
- **AC4 — Odrzucenie podczas oceny:** Jeśli ocena odrzuci kombinację, którą ekran pozwolił klientowi utworzyć, wyświetl jasny powód, nie dodawaj mieszanki do koszyka i zachowaj konfigurację. Po jej poprawieniu klient może pomyślnie dodać mieszankę do koszyka.
- **AC5 — Edycja mieszanki:** Gdy w koszyku jest jedna mieszanka, jej edycja przywraca materiał bazowy, składniki i proporcje w konfiguratorze. Zapisanie zmian aktualizuje skład i cenę tej samej pozycji w koszyku, zamiast dodawać kolejną.
