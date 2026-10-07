Przeczytaj `workshop/feature-ticket.md` i zapisz plan testów E2E wyłącznie w `workshop/e2e-plan.md`. To ma być jedyna zmiana w repozytorium. Napisz plan po angielsku, w maksymalnie 1500 słowach. Nie korzystaj z subagentów, nie zadawaj pytań i nie implementuj testów.

Pracuj wyłącznie przez statyczne czytanie plików repozytorium. Nie otwieraj przeglądarki, nie uruchamiaj aplikacji ani testów, nie instaluj zależności i nie resetuj bazy danych. Sprawdź kod oraz istniejące testy E2E i testy niższego poziomu bezpośrednio związane z AC1–AC5. Zakończ analizę, gdy masz podstawy do scenariuszy, danych i oczekiwanych wyników; pozostałe niewiadome oznacz jako założenia. Nie analizuj finalizacji zakupu ani pełnej macierzy pokrycia.

Zaproponuj maksymalnie 4 niezależne scenariusze przeglądarkowe, uporządkowane według ryzyka. Każde AC1–AC5 musi mieć reprezentatywne pokrycie w scenariuszu; testy niższego poziomu mogą uzasadniać pominięcie dodatkowych wariantów, ale nie całego AC. Nie powielaj w E2E macierzy reguł ani wariantów cenowych sprawdzonych niżej.

Podaj wspólne przygotowanie oraz dla każdego scenariusza: priorytet z krótkim uzasadnieniem ryzyka, odtwarzalne dane (materiał bazowy, składniki, proporcje, ilość, kraj i waluta), krótkie numerowane kroki, konkretne widoczne wyniki i powiązanie z AC. Oczekiwane ceny oprzyj na źródle niezależnym od wartości wyświetlanej przez interfejs. Przy ustaleniach podaj zwięzłe dowody z najważniejszych plików, oddziel stan kodu od wymaganego zachowania i zaznacz założenia.

Użyj dokładnie tych nagłówków, w podanej kolejności: `## Scenarios`, `## Existing coverage`, `## Risks`, `## Approach`. W `## Risks` wskaż istotne rozbieżności między zgłoszeniem a kodem oraz niezweryfikowane założenia.
