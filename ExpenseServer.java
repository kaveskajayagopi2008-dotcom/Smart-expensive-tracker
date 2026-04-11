import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;

import java.io.*;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.HashMap;

/*
 * Smart Expense Splitter Pro - Backend Server
 *
 * HOW TO RUN:
 *   Step 1:  javac ExpenseServer.java
 *   Step 2:  java ExpenseServer
 *   Step 3:  Server starts at http://localhost:8080
 *   Step 4:  Open index.html in your browser
 *
 * ENDPOINTS:
 *   GET  /api/health  ->  {"status":"ok"}
 *   POST /api/settle  ->  settlement result JSON
 */
public class ExpenseServer {

    static final int PORT = 8080;

    public static void main(String[] args) throws IOException {
        // Create HTTP server bound to port 8080
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        // Map URL paths to handler classes
        server.createContext("/api/health", new HealthHandler());
        server.createContext("/api/settle", new SettleHandler());

        // Use default thread pool and start
        server.setExecutor(null);
        server.start();

        System.out.println("===========================================");
        System.out.println("  Server running at http://localhost:" + PORT);
        System.out.println("  Press Ctrl+C to stop");
        System.out.println("===========================================");
    }


    // ─────────────────────────────────────────
    //  HANDLER 1: Health Check
    //  Returns {"status":"ok"} for GET /api/health
    //  Frontend pings this to show "Server Online"
    // ─────────────────────────────────────────
    static class HealthHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            addCorsHeaders(ex);

            // Browser sends OPTIONS before every real request (preflight)
            if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
                ex.sendResponseHeaders(204, -1);
                return;
            }

            sendJson(ex, 200, "{\"status\":\"ok\"}");
        }
    }


    // ─────────────────────────────────────────
    //  HANDLER 2: Settle
    //  Reads JSON body, runs algorithm, returns result
    // ─────────────────────────────────────────
    static class SettleHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            addCorsHeaders(ex);

            // Handle browser preflight
            if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
                ex.sendResponseHeaders(204, -1);
                return;
            }

            // Only POST allowed
            if (!ex.getRequestMethod().equalsIgnoreCase("POST")) {
                sendJson(ex, 405, "{\"error\":\"Use POST method\"}");
                return;
            }

            // Read request body
            String body = readAll(ex.getRequestBody());
            System.out.println("[REQUEST] " + body);

            try {
                String result = settle(body);
                System.out.println("[RESPONSE] " + result);
                sendJson(ex, 200, result);
            } catch (Exception e) {
                System.out.println("[ERROR] " + e.getMessage());
                sendJson(ex, 400, "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
            }
        }
    }


    // ─────────────────────────────────────────
    //  SETTLEMENT ALGORITHM  (Greedy Min-Max)
    //
    //  Step 1: Sum up what each person paid
    //  Step 2: fairShare = total / number of people
    //  Step 3: balance = paid - fairShare
    //            positive = they are OWED money (creditor)
    //            negative = they OWE money     (debtor)
    //  Step 4: Sort creditors and debtors by amount (largest first)
    //  Step 5: Match biggest creditor with biggest debtor
    //          Transfer the smaller of the two amounts
    //          Drop whoever reached zero, carry the rest forward
    //  Step 6: Repeat until all balances are zero
    //  Result: minimum number of transactions to settle everyone
    // ─────────────────────────────────────────
    static String settle(String json) throws Exception {

        ArrayList<String> members  = parseMembers(json);
        ArrayList<String[]> expenses = parseExpenses(json);

        if (members.size() < 2)    throw new Exception("Need at least 2 members");
        if (expenses.size() == 0)  throw new Exception("Need at least one expense");

        // --- Step 1: total paid per person ---
        HashMap<String, Double> paid = new HashMap<String, Double>();
        for (int i = 0; i < members.size(); i++) {
            paid.put(members.get(i), 0.0);
        }

        double total = 0;
        for (int i = 0; i < expenses.size(); i++) {
            String who = expenses.get(i)[0];   // paidBy
            double amt = Double.parseDouble(expenses.get(i)[2]); // amount

            // Safety: if who is not a known member skip
            if (!paid.containsKey(who)) {
                throw new Exception("'" + who + "' is not in the members list");
            }

            paid.put(who, paid.get(who) + amt);
            total += amt;
        }

        // --- Step 2: fair share ---
        double share = total / members.size();

        // --- Step 3: balance per person ---
        HashMap<String, Double> bal = new HashMap<String, Double>();
        for (int i = 0; i < members.size(); i++) {
            String m = members.get(i);
            double b = round2(paid.get(m) - share);
            bal.put(m, b);
        }

        // --- Step 4: split into creditors and debtors ---
        ArrayList<String>  cNames = new ArrayList<String>();
        ArrayList<Double>  cAmts  = new ArrayList<Double>();
        ArrayList<String>  dNames = new ArrayList<String>();
        ArrayList<Double>  dAmts  = new ArrayList<Double>();

        for (int i = 0; i < members.size(); i++) {
            String m = members.get(i);
            double b = bal.get(m);
            if (b > 0.005) {
                cNames.add(m);
                cAmts.add(b);
            } else if (b < -0.005) {
                dNames.add(m);
                dAmts.add(-b); // store as positive
            }
        }

        // Sort both lists: largest amount first (bubble sort)
        bubbleSort(cNames, cAmts);
        bubbleSort(dNames, dAmts);

        // --- Step 5 & 6: match and generate transactions ---
        ArrayList<String> txns = new ArrayList<String>();

        int ci = 0; // creditor pointer
        int di = 0; // debtor pointer

        while (ci < cNames.size() && di < dNames.size()) {
            double give = cAmts.get(ci);  // creditor is owed this
            double take = dAmts.get(di);  // debtor owes this

            double transfer = round2(Math.min(give, take));

            // debtor pays creditor
            String txn = "{"
                + "\"from\":\"" + escapeJson(dNames.get(di)) + "\","
                + "\"to\":\""   + escapeJson(cNames.get(ci)) + "\","
                + "\"amount\":" + transfer
                + "}";
            txns.add(txn);

            // Reduce both
            cAmts.set(ci, round2(give - transfer));
            dAmts.set(di, round2(take - transfer));

            if (cAmts.get(ci) < 0.005) ci++; // creditor fully settled
            if (dAmts.get(di) < 0.005) di++; // debtor fully settled
        }

        // --- Build JSON response ---
        // balances array
        StringBuilder bArr = new StringBuilder("[");
        for (int i = 0; i < members.size(); i++) {
            if (i > 0) bArr.append(",");
            String m = members.get(i);
            bArr.append("{")
                .append("\"name\":")      .append("\"").append(escapeJson(m)).append("\",")
                .append("\"paid\":")      .append(round2(paid.get(m))).append(",")
                .append("\"fairShare\":") .append(round2(share)).append(",")
                .append("\"balance\":")   .append(bal.get(m))
                .append("}");
        }
        bArr.append("]");

        // transactions array
        StringBuilder tArr = new StringBuilder("[");
        for (int i = 0; i < txns.size(); i++) {
            if (i > 0) tArr.append(",");
            tArr.append(txns.get(i));
        }
        tArr.append("]");

        return "{"
            + "\"totalExpense\":"    + round2(total)          + ","
            + "\"fairShare\":"       + round2(share)          + ","
            + "\"memberCount\":"     + members.size()         + ","
            + "\"transactionCount\":" + txns.size()           + ","
            + "\"balances\":"        + bArr.toString()        + ","
            + "\"transactions\":"    + tArr.toString()
            + "}";
    }


    // ─────────────────────────────────────────
    //  BUBBLE SORT  (sorts parallel lists together)
    //  Sorts by amount descending (largest first)
    // ─────────────────────────────────────────
    static void bubbleSort(ArrayList<String> names, ArrayList<Double> amts) {
        int n = amts.size();
        for (int i = 0; i < n - 1; i++) {
            for (int j = 0; j < n - 1 - i; j++) {
                if (amts.get(j) < amts.get(j + 1)) {
                    // swap amounts
                    double tmpA = amts.get(j);
                    amts.set(j, amts.get(j + 1));
                    amts.set(j + 1, tmpA);
                    // swap names together
                    String tmpN = names.get(j);
                    names.set(j, names.get(j + 1));
                    names.set(j + 1, tmpN);
                }
            }
        }
    }


    // ─────────────────────────────────────────
    //  JSON PARSER: members array
    //  Input:  {"members":["Alice","Bob"],...}
    //  Output: ArrayList ["Alice", "Bob"]
    // ─────────────────────────────────────────
    static ArrayList<String> parseMembers(String json) {
        ArrayList<String> list = new ArrayList<String>();

        // Find "members" key
        int keyPos = json.indexOf("\"members\"");
        if (keyPos == -1) return list;

        // Find opening [
        int open = json.indexOf("[", keyPos);
        if (open == -1) return list;

        // Find closing ] -- the FIRST ] after [
        int close = json.indexOf("]", open);
        if (close == -1) return list;

        // Extract content between [ and ]
        String content = json.substring(open + 1, close).trim();
        if (content.isEmpty()) return list;

        // Split by comma, clean up each name
        String[] parts = content.split(",");
        for (int i = 0; i < parts.length; i++) {
            String name = parts[i].trim();
            // Remove surrounding quotes
            if (name.startsWith("\"")) name = name.substring(1);
            if (name.endsWith("\""))   name = name.substring(0, name.length() - 1);
            name = name.trim();
            if (name.length() > 0) list.add(name);
        }
        return list;
    }


    // ─────────────────────────────────────────
    //  JSON PARSER: expenses array
    //  Input:  {"expenses":[{"paidBy":"A","description":"food","amount":100},...]}
    //  Output: ArrayList of String[] {paidBy, description, amount}
    // ─────────────────────────────────────────
    static ArrayList<String[]> parseExpenses(String json) {
        ArrayList<String[]> list = new ArrayList<String[]>();

        int keyPos = json.indexOf("\"expenses\"");
        if (keyPos == -1) return list;

        int open = json.indexOf("[", keyPos);
        if (open == -1) return list;

        // Find the MATCHING closing bracket (handle nested {})
        int depth = 0;
        int close = -1;
        for (int i = open; i < json.length(); i++) {
            if (json.charAt(i) == '[') depth++;
            if (json.charAt(i) == ']') { depth--; if (depth == 0) { close = i; break; } }
        }
        if (close == -1) return list;

        String content = json.substring(open + 1, close);

        // Walk through each { ... } block
        int pos = 0;
        while (pos < content.length()) {
            int objOpen  = content.indexOf("{", pos);
            if (objOpen == -1) break;

            // Find matching }
            int objClose = content.indexOf("}", objOpen);
            if (objClose == -1) break;

            String obj = content.substring(objOpen + 1, objClose);

            String paidBy = getField(obj, "paidBy");
            String desc   = getField(obj, "description");
            String amount = getField(obj, "amount");

            if (paidBy != null && paidBy.length() > 0 && amount != null && amount.length() > 0) {
                list.add(new String[]{ paidBy, desc == null ? "" : desc, amount });
            }

            pos = objClose + 1;
        }
        return list;
    }


    // ─────────────────────────────────────────
    //  HELPER: Extract one field value from a
    //  JSON object fragment (no nested objects)
    //  e.g. getField(`"paidBy":"Alice","amount":100`, "paidBy") => "Alice"
    //       getField(`"paidBy":"Alice","amount":100`, "amount") => "100"
    // ─────────────────────────────────────────
    static String getField(String obj, String key) {
        String search = "\"" + key + "\"";
        int kp = obj.indexOf(search);
        if (kp == -1) return null;

        int colon = obj.indexOf(":", kp + search.length());
        if (colon == -1) return null;

        String rest = obj.substring(colon + 1).trim();

        if (rest.startsWith("\"")) {
            // String value
            int end = rest.indexOf("\"", 1);
            if (end == -1) return null;
            return rest.substring(1, end);
        } else {
            // Number or boolean
            int end = rest.length();
            for (int i = 0; i < rest.length(); i++) {
                char c = rest.charAt(i);
                if (c == ',' || c == '}' || c == ' ') { end = i; break; }
            }
            return rest.substring(0, end).trim();
        }
    }


    // ─────────────────────────────────────────
    //  HELPER: Read entire InputStream to String
    // ─────────────────────────────────────────
    static String readAll(InputStream in) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(in, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
        }
        return sb.toString();
    }


    // ─────────────────────────────────────────
    //  HELPER: Send a JSON HTTP response
    // ─────────────────────────────────────────
    static void sendJson(HttpExchange ex, int code, String body) throws IOException {
        byte[] bytes = body.getBytes("UTF-8");
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        ex.sendResponseHeaders(code, bytes.length);
        OutputStream out = ex.getResponseBody();
        out.write(bytes);
        out.close();
    }


    // ─────────────────────────────────────────
    //  HELPER: Add CORS headers so the browser
    //  allows fetch() from index.html to localhost
    // ─────────────────────────────────────────
    static void addCorsHeaders(HttpExchange ex) {
        ex.getResponseHeaders().set("Access-Control-Allow-Origin",  "*");
        ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type, Accept");
    }


    // ─────────────────────────────────────────
    //  HELPER: Round a double to 2 decimal places
    // ─────────────────────────────────────────
    static double round2(double val) {
        return Math.round(val * 100.0) / 100.0;
    }


    // ─────────────────────────────────────────
    //  HELPER: Escape special chars inside JSON strings
    //  Prevents broken JSON if a name has quotes/backslashes
    // ─────────────────────────────────────────
    static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}
